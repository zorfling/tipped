import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  assignments,
  blocks,
  buckets,
  events,
  registrations,
  rounds,
  type Event,
  type Registration,
  type Round,
  type Tx,
} from "@/db";
import { scheduleRounds, type Pair } from "@/lib/rotation";
import { sendEventEmail } from "@/lib/email";

export const CHECKIN_OPENS_BEFORE_MS = 15 * 60 * 1000;
export const CHECKIN_GRACE_AFTER_MS = 10 * 60 * 1000;
export const MIN_PER_SIDE_TO_RUN = 3;

async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`);
}

/** Blocked registration pairs [sideA regId, sideB regId] for a set of regs. */
async function blockedRegPairs(
  tx: Tx,
  sideA: Registration[],
  sideB: Registration[],
): Promise<Pair[]> {
  const userIds = [...sideA, ...sideB].map((r) => r.userId);
  if (userIds.length === 0) return [];
  const blockRows = await tx
    .select()
    .from(blocks)
    .where(
      and(inArray(blocks.blockerUserId, userIds), inArray(blocks.blockedUserId, userIds)),
    );
  const byUserA = new Map(sideA.map((r) => [r.userId, r.id]));
  const byUserB = new Map(sideB.map((r) => [r.userId, r.id]));
  const pairs: Pair[] = [];
  for (const b of blockRows) {
    const a1 = byUserA.get(b.blockerUserId);
    const b1 = byUserB.get(b.blockedUserId);
    if (a1 && b1) pairs.push([a1, b1]);
    const a2 = byUserA.get(b.blockedUserId);
    const b2 = byUserB.get(b.blockerUserId);
    if (a2 && b2) pairs.push([a2, b2]);
  }
  return pairs;
}

/**
 * Generate the full night schedule for one event: rounds with timestamps and
 * all assignments. Runs once (idempotent via status flip tipped→live under the
 * event lock). Too few checked in → the event auto-cancels night-of.
 */
export async function generateScheduleForEvent(
  eventId: string,
  now: Date,
): Promise<"scheduled" | "cancelled_night_of" | "skipped"> {
  const outcome = await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const [event] = await tx.select().from(events).where(eq(events.id, eventId));
    if (!event || event.status !== "tipped") return "skipped" as const;
    if (now.getTime() < event.startsAt.getTime() + CHECKIN_GRACE_AFTER_MS) {
      return "skipped" as const;
    }

    const eventBuckets = await tx
      .select()
      .from(buckets)
      .where(eq(buckets.eventId, eventId))
      .orderBy(asc(buckets.sortOrder));
    const checkedIn = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.state, "checked_in")))
      .orderBy(asc(registrations.checkedInAt), asc(registrations.id));

    const sideA = checkedIn.filter((r) => r.bucketId === eventBuckets[0]?.id);
    const sideB = checkedIn.filter((r) => r.bucketId === eventBuckets[1]?.id);

    if (sideA.length < MIN_PER_SIDE_TO_RUN || sideB.length < MIN_PER_SIDE_TO_RUN) {
      await tx.update(events).set({ status: "cancelled" }).where(eq(events.id, eventId));
      return "cancelled_night_of" as const;
    }

    const blocked = await blockedRegPairs(tx, sideA, sideB);
    const schedule = scheduleRounds(
      sideA.map((r) => r.id),
      sideB.map((r) => r.id),
      blocked,
    );

    const base = new Date(Math.max(now.getTime(), event.startsAt.getTime()) + 60_000);
    const cadence = (event.roundLengthSec + event.breakLengthSec) * 1000;

    for (let i = 0; i < schedule.length; i++) {
      const start = new Date(base.getTime() + i * cadence);
      const end = new Date(start.getTime() + event.roundLengthSec * 1000);
      const [round] = await tx
        .insert(rounds)
        .values({
          eventId,
          number: i + 1,
          scheduledStartAt: start,
          scheduledEndAt: end,
        })
        .returning();
      const rows = schedule[i]
        .filter((p) => p.a !== null || p.b !== null)
        .map((p) => ({
          roundId: round.id,
          // Convention: paired rows are (sideA, sideB); a bye row holds the
          // resting registration in registration_a_id with b null.
          registrationAId: (p.a ?? p.b)!,
          registrationBId: p.a === null ? null : p.b,
        }));
      if (rows.length) await tx.insert(assignments).values(rows);
    }

    await tx.update(events).set({ status: "live" }).where(eq(events.id, eventId));
    return "scheduled" as const;
  });

  if (outcome === "cancelled_night_of") {
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    const attendees = await db
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          inArray(registrations.state, ["confirmed", "checked_in"]),
        ),
      );
    for (const reg of attendees) {
      await sendNightCancelledEmail(event, reg);
    }
  }
  return outcome;
}

async function sendNightCancelledEmail(event: Event, reg: Registration): Promise<void> {
  const { users } = await import("@/db");
  const [user] = await db.select().from(users).where(eq(users.id, reg.userId));
  if (!user) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "night_cancelled",
    mail: {
      to: user.email,
      subject: `We're so sorry — tonight's event couldn't run: ${event.title}`,
      html: `<p>Too few people checked in tonight for <strong>${event.title}</strong> to run properly, so it was called off.</p>
<p>We're really sorry — you turned up and that matters. This is rare: everyone tonight had paid and committed.</p>`,
    },
  });
}

/** Cron hook: generate schedules for any tipped event past starts_at + grace. */
export async function generateDueSchedules(now = new Date()): Promise<string[]> {
  const due = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.status, "tipped"),
        lte(events.startsAt, new Date(now.getTime() - CHECKIN_GRACE_AFTER_MS)),
      ),
    );
  const scheduled: string[] = [];
  for (const event of due) {
    const outcome = await generateScheduleForEvent(event.id, now);
    if (outcome === "scheduled") scheduled.push(event.id);
  }
  return scheduled;
}

export type CheckInResult =
  | { ok: true; late: boolean }
  | { ok: false; error: string };

/**
 * Self check-in. Normal window: starts_at − 15 min → starts_at + 10 min.
 * Late window: until round 2 ends, filling bye seats only.
 */
export async function checkIn(opts: {
  userId: string;
  eventId: string;
  now?: Date;
}): Promise<CheckInResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockEvent(tx, opts.eventId);
    const [event] = await tx.select().from(events).where(eq(events.id, opts.eventId));
    if (!event) return { ok: false as const, error: "Event not found" };

    const [reg] = await tx
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.eventId, opts.eventId), eq(registrations.userId, opts.userId)),
      );
    if (!reg) return { ok: false as const, error: "You're not registered for this event" };
    if (reg.state === "checked_in") return { ok: true as const, late: false };
    if (reg.state !== "confirmed") {
      return { ok: false as const, error: "Only confirmed attendees can check in" };
    }

    const opens = event.startsAt.getTime() - CHECKIN_OPENS_BEFORE_MS;
    if (now.getTime() < opens) {
      return { ok: false as const, error: "Check-in isn't open yet" };
    }

    if (event.status === "tipped") {
      if (now.getTime() > event.startsAt.getTime() + CHECKIN_GRACE_AFTER_MS) {
        // Grace passed but schedule not yet generated — still fine to slip in.
      }
      await tx
        .update(registrations)
        .set({ state: "checked_in", checkedInAt: now })
        .where(eq(registrations.id, reg.id));
      return { ok: true as const, late: false };
    }

    if (event.status === "live") {
      // Late arrival: allowed until round 2 ends; fills bye seats from the
      // next round onward. Never regenerate mid-event.
      const eventRounds = await tx
        .select()
        .from(rounds)
        .where(eq(rounds.eventId, opts.eventId))
        .orderBy(asc(rounds.number));
      const round2 = eventRounds.find((r) => r.number === 2) ?? eventRounds.at(-1);
      if (!round2 || now.getTime() >= round2.scheduledEndAt.getTime()) {
        return { ok: false as const, error: "Check-in has closed for tonight" };
      }
      await tx
        .update(registrations)
        .set({ state: "checked_in", checkedInAt: now })
        .where(eq(registrations.id, reg.id));
      await fillByeSeats(tx, event, reg, eventRounds, now);
      return { ok: true as const, late: true };
    }

    return { ok: false as const, error: "Check-in isn't available for this event" };
  });
}

/** Give a late arrival partners by taking over other participants' bye rounds. */
async function fillByeSeats(
  tx: Tx,
  event: Event,
  lateReg: Registration,
  eventRounds: Round[],
  now: Date,
): Promise<void> {
  const eventBuckets = await tx
    .select()
    .from(buckets)
    .where(eq(buckets.eventId, event.id))
    .orderBy(asc(buckets.sortOrder));
  const lateIsSideA = lateReg.bucketId === eventBuckets[0]?.id;

  const oppositeRegs = await tx
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, event.id),
        eq(registrations.bucketId, lateIsSideA ? eventBuckets[1].id : eventBuckets[0].id),
      ),
    );
  const oppositeIds = new Set(oppositeRegs.map((r) => r.id));
  const oppositeUserByReg = new Map(oppositeRegs.map((r) => [r.id, r.userId]));

  // People the late arrival must never be paired with
  const blockRows = await tx
    .select()
    .from(blocks)
    .where(
      or(eq(blocks.blockerUserId, lateReg.userId), eq(blocks.blockedUserId, lateReg.userId)),
    );
  const blockedUsers = new Set(
    blockRows.map((b) => (b.blockerUserId === lateReg.userId ? b.blockedUserId : b.blockerUserId)),
  );

  const met = new Set<string>();
  const futureRounds = eventRounds
    .filter((r) => r.scheduledStartAt.getTime() > now.getTime())
    .sort((a, b) => a.number - b.number);

  for (const round of futureRounds) {
    const roundAssignments = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.roundId, round.id));
    // A bye row on the opposite side = a partner going spare this round
    const candidate = roundAssignments.find(
      (a) =>
        a.registrationBId === null &&
        oppositeIds.has(a.registrationAId) &&
        !met.has(a.registrationAId) &&
        !blockedUsers.has(oppositeUserByReg.get(a.registrationAId) ?? ""),
    );
    if (!candidate) continue;
    met.add(candidate.registrationAId);
    await tx
      .update(assignments)
      .set(
        lateIsSideA
          ? { registrationAId: lateReg.id, registrationBId: candidate.registrationAId }
          : { registrationAId: candidate.registrationAId, registrationBId: lateReg.id },
      )
      .where(eq(assignments.id, candidate.id));
  }
}

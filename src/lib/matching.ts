import { and, asc, eq, inArray, isNull, lt, max, sql } from "drizzle-orm";
import {
  db,
  events,
  matches,
  picks,
  registrations,
  rounds,
  users,
  type Event,
  type Tx,
} from "@/db";
import { sendEventEmail } from "@/lib/email";

/** Picks stay editable until final round end + this buffer; then the event closes. */
export const CLOSE_AFTER_FINAL_ROUND_MS = 15 * 60 * 1000;

/** Reveal emails go out the morning after, at 9am in this timezone (MVP: fixed). */
export const REVEAL_TIMEZONE_OFFSET_HOURS = 10; // Australia/Brisbane, no DST
export const REVEAL_HOUR_LOCAL = 9;

async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`);
}

/**
 * Close a live event once final round + buffer has passed: compute mutual
 * yeses, write matches, flip to matched. Non-mutual picks are never surfaced
 * anywhere — they only exist in the picks table until the purge.
 */
export async function closeEvent(eventId: string, now: Date): Promise<"matched" | "skipped"> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const [event] = await tx.select().from(events).where(eq(events.id, eventId));
    if (!event || event.status !== "live") return "skipped" as const;

    const [{ lastEnd }] = await tx
      .select({ lastEnd: max(rounds.scheduledEndAt) })
      .from(rounds)
      .where(eq(rounds.eventId, eventId));
    if (!lastEnd || now.getTime() < lastEnd.getTime() + CLOSE_AFTER_FINAL_ROUND_MS) {
      return "skipped" as const;
    }

    const eventPicks = await tx.select().from(picks).where(eq(picks.eventId, eventId));
    const yes = new Set(
      eventPicks
        .filter((p) => p.choice === "yes")
        .map((p) => `${p.fromRegistrationId}|${p.toRegistrationId}`),
    );
    const seen = new Set<string>();
    for (const p of eventPicks) {
      if (p.choice !== "yes") continue;
      const key = [p.fromRegistrationId, p.toRegistrationId].sort().join("|");
      if (seen.has(key)) continue;
      if (yes.has(`${p.toRegistrationId}|${p.fromRegistrationId}`)) {
        seen.add(key);
        const [a, b] = [p.fromRegistrationId, p.toRegistrationId].sort();
        await tx.insert(matches).values({ eventId, registrationAId: a, registrationBId: b });
      }
    }

    await tx.update(events).set({ status: "matched" }).where(eq(events.id, eventId));
    return "matched" as const;
  });
}

export async function closeDueEvents(now = new Date()): Promise<string[]> {
  const live = await db.select().from(events).where(eq(events.status, "live"));
  const closed: string[] = [];
  for (const event of live) {
    if ((await closeEvent(event.id, now)) === "matched") closed.push(event.id);
  }
  return closed;
}

function revealTimeFor(event: Event): Date {
  // Morning after the event: 9am local (fixed offset, see constant).
  const local = new Date(
    event.startsAt.getTime() + REVEAL_TIMEZONE_OFFSET_HOURS * 3600 * 1000,
  );
  const nextMorningUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, REVEAL_HOUR_LOCAL) -
    REVEAL_TIMEZONE_OFFSET_HOURS * 3600 * 1000;
  return new Date(nextMorningUtcMs);
}

/**
 * The morning-after reveal. Emails each attendee their mutual matches (name,
 * photo, contact email). People with no mutuals get nothing — never a
 * "nobody picked you" email. Idempotent via email_log + revealed_at.
 */
export async function revealDueMatches(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(events)
    .where(eq(events.status, "matched"));
  let sent = 0;

  for (const event of due) {
    if (now.getTime() < revealTimeFor(event).getTime()) continue;
    const unrevealed = await db
      .select()
      .from(matches)
      .where(and(eq(matches.eventId, event.id), isNull(matches.revealedAt)));
    if (unrevealed.length === 0) continue;

    // Collect matches per registration
    const regIds = [
      ...new Set(unrevealed.flatMap((m) => [m.registrationAId, m.registrationBId])),
    ];
    const regRows = await db
      .select({
        regId: registrations.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        photoUrl: users.photoUrl,
      })
      .from(registrations)
      .innerJoin(users, eq(registrations.userId, users.id))
      .where(inArray(registrations.id, regIds));
    const byReg = new Map(regRows.map((r) => [r.regId, r]));

    const perPerson = new Map<string, typeof regRows>();
    for (const m of unrevealed) {
      const a = byReg.get(m.registrationAId);
      const b = byReg.get(m.registrationBId);
      if (!a || !b) continue;
      perPerson.set(m.registrationAId, [...(perPerson.get(m.registrationAId) ?? []), b]);
      perPerson.set(m.registrationBId, [...(perPerson.get(m.registrationBId) ?? []), a]);
    }

    for (const [regId, theirMatches] of perPerson) {
      const me = byReg.get(regId);
      if (!me) continue;
      const list = theirMatches
        .map(
          (m) =>
            `<div style="margin:12px 0"><img src="${process.env.APP_URL}${m.photoUrl}" width="96" height="96" style="border-radius:12px;object-fit:cover" alt="" /><br><strong>${m.name}</strong> — <a href="mailto:${m.email}">${m.email}</a></div>`,
        )
        .join("");
      const delivered = await sendEventEmail({
        eventId: event.id,
        registrationId: regId,
        type: "match_reveal",
        mail: {
          to: me.email,
          subject: `You matched! ${event.title}`,
          html: `<p>Good morning ☀️ You have ${theirMatches.length === 1 ? "a mutual match" : `${theirMatches.length} mutual matches`} from <strong>${event.title}</strong>:</p>
${list}
<p>They said yes to you, you said yes to them — the rest is up to you.</p>
<p style="color:#666;font-size:13px">Only mutual yeses are ever revealed, to anyone. Manage matches (or block/report) at <a href="${process.env.APP_URL}/e/${event.slug}/matches">your matches page</a>.</p>`,
        },
      });
      if (delivered) sent++;
    }

    await db
      .update(matches)
      .set({ revealedAt: now })
      .where(and(eq(matches.eventId, event.id), isNull(matches.revealedAt)));
  }
  return sent;
}

/** Privacy rule: purge picks 30 days after the event. Matches remain. */
export async function purgeOldPicks(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const oldEvents = await db
    .select({ id: events.id })
    .from(events)
    .where(lt(events.startsAt, cutoff));
  if (oldEvents.length === 0) return 0;
  const deleted = await db
    .delete(picks)
    .where(inArray(picks.eventId, oldEvents.map((e) => e.id)))
    .returning({ id: picks.id });
  return deleted.length;
}

/** Upsert a pick; only valid for someone you were actually assigned to meet. */
export async function submitPick(opts: {
  eventId: string;
  fromRegistrationId: string;
  toRegistrationId: string;
  choice: "yes" | "no";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [event] = await db.select().from(events).where(eq(events.id, opts.eventId));
  if (!event) return { ok: false, error: "Event not found" };
  if (event.status !== "live" && event.status !== "matched") {
    return { ok: false, error: "Picks aren't open for this event" };
  }
  if (event.status === "matched") {
    return { ok: false, error: "Picks have closed — matches are already out" };
  }

  // Must have actually met (or be scheduled to meet) this person
  const eventRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.eventId, opts.eventId))
    .orderBy(asc(rounds.number));
  const { assignments } = await import("@/db");
  const met = await db
    .select()
    .from(assignments)
    .where(
      and(
        inArray(assignments.roundId, eventRounds.map((r) => r.id)),
        inArray(assignments.registrationAId, [opts.fromRegistrationId, opts.toRegistrationId]),
      ),
    );
  const wereAssigned = met.some(
    (a) =>
      (a.registrationAId === opts.fromRegistrationId && a.registrationBId === opts.toRegistrationId) ||
      (a.registrationAId === opts.toRegistrationId && a.registrationBId === opts.fromRegistrationId),
  );
  if (!wereAssigned) return { ok: false, error: "You weren't paired with this person" };

  await db
    .insert(picks)
    .values({
      eventId: opts.eventId,
      fromRegistrationId: opts.fromRegistrationId,
      toRegistrationId: opts.toRegistrationId,
      choice: opts.choice,
    })
    .onConflictDoUpdate({
      target: [picks.fromRegistrationId, picks.toRegistrationId],
      set: { choice: opts.choice },
    });
  return { ok: true };
}

export async function ensureClosed(event: Event, now: Date): Promise<Event> {
  if (event.status === "live") {
    const outcome = await closeEvent(event.id, now);
    if (outcome === "matched") {
      const [refreshed] = await db.select().from(events).where(eq(events.id, event.id));
      return refreshed;
    }
  }
  return event;
}

import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  buckets,
  events,
  registrations,
  type Event,
  type Registration,
  type Tx,
} from "@/db";
import { ACTIVE_STATES } from "@/lib/constants";
import { isSatisfied, type ActiveCounts, type CompositionConfig } from "@/lib/composition";
import {
  sendChargeFailedEmail,
  sendFizzledEmail,
  sendReminderEmail,
  sendTippedReceiptEmail,
} from "@/lib/notifications";
import { chargeRegistration } from "@/lib/payments";

export interface TipperResult {
  tipped: string[];
  fizzled: string[];
  chargesSucceeded: number;
  chargesFailed: number;
  remindersSent: number;
}

async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`);
}

/**
 * Settle one due event: flip it to tipped or fizzled inside the event lock,
 * then (outside the transaction) charge / email. Safe to run repeatedly —
 * status flips once, charges and emails are idempotent.
 */
export async function settleEvent(eventId: string): Promise<"tipped" | "fizzled" | "skipped"> {
  const outcome = await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const [event] = await tx.select().from(events).where(eq(events.id, eventId));
    if (!event || event.status !== "open") return "skipped" as const;

    const eventBuckets = await tx.select().from(buckets).where(eq(buckets.eventId, eventId));
    const countRows = await tx
      .select({ bucketId: registrations.bucketId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(registrations)
      .where(
        and(eq(registrations.eventId, eventId), inArray(registrations.state, [...ACTIVE_STATES])),
      )
      .groupBy(registrations.bucketId);
    const counts: ActiveCounts = Object.fromEntries(eventBuckets.map((b) => [b.id, 0]));
    for (const row of countRows) counts[row.bucketId] = row.n;
    const cfg: CompositionConfig = {
      buckets: eventBuckets.map((b) => ({ id: b.id, minSize: b.minSize, maxSize: b.maxSize })),
      maxImbalance: event.maxImbalance,
    };

    if (isSatisfied(cfg, counts)) {
      await tx.update(events).set({ status: "tipped" }).where(eq(events.id, eventId));
      return "tipped" as const;
    }
    // Fizzle: release everyone still holding or hoping for a spot. No charges, ever.
    await tx.update(events).set({ status: "fizzled" }).where(eq(events.id, eventId));
    await tx
      .update(registrations)
      .set({ state: "released" })
      .where(
        and(
          eq(registrations.eventId, eventId),
          inArray(registrations.state, ["reserved", "waitlisted"]),
        ),
      );
    return "fizzled" as const;
  });
  return outcome;
}

async function chargeTippedEvent(
  eventId: string,
): Promise<{ succeeded: number; failed: number }> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (event.status !== "tipped") return { succeeded: 0, failed: 0 };

  // Reserved regs get charged; already-confirmed ones (reruns) are skipped by
  // chargeRegistration's idempotency but still get their receipt retried.
  const toCharge = await db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        inArray(registrations.state, ["reserved", "confirmed"]),
      ),
    )
    .orderBy(asc(registrations.createdAt));

  let succeeded = 0;
  let failed = 0;
  for (const reg of toCharge) {
    const outcome = await chargeRegistration(event, reg);
    if (outcome.status === "succeeded") {
      succeeded++;
      await db
        .update(registrations)
        .set({ state: "confirmed" })
        .where(and(eq(registrations.id, reg.id), eq(registrations.state, "reserved")));
      await sendTippedReceiptEmail(event, reg, outcome.charge.amountCents);
    } else {
      // failed or requires_action: keep reserved, send the fix link. The
      // webhook / fix flow moves it forward; unresolved failures are excluded
      // from the night-of schedule (they never reach checked_in).
      failed++;
      await sendChargeFailedEmail(event, reg);
    }
  }
  return { succeeded, failed };
}

async function emailFizzled(eventId: string): Promise<void> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const released = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.state, "released")));
  for (const reg of released) await sendFizzledEmail(event, reg);
}

async function sendDayBeforeReminders(now: Date): Promise<number> {
  const soon = await db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.status, ["tipped", "locked"]),
        gt(events.startsAt, now),
        lte(events.startsAt, new Date(now.getTime() + 24 * 3600 * 1000)),
      ),
    );
  let sent = 0;
  for (const event of soon) {
    const confirmed = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, event.id), eq(registrations.state, "confirmed")));
    for (const reg of confirmed) {
      await sendReminderEmail(event, reg);
      sent++;
    }
  }
  return sent;
}

/** The 10-minute cron: settle due events, charge tipped ones, remind tomorrow's. */
export async function runTipper(now = new Date()): Promise<TipperResult> {
  const result: TipperResult = {
    tipped: [],
    fizzled: [],
    chargesSucceeded: 0,
    chargesFailed: 0,
    remindersSent: 0,
  };

  const due = await db
    .select()
    .from(events)
    .where(and(eq(events.status, "open"), lte(events.tipDeadlineAt, now)));

  for (const event of due) {
    const outcome = await settleEvent(event.id);
    if (outcome === "fizzled") {
      result.fizzled.push(event.id);
      await emailFizzled(event.id);
    } else if (outcome === "tipped") {
      result.tipped.push(event.id);
    }
  }

  // Charge every current tipped event (not just freshly tipped — retries
  // receipts and fix-emails for events settled on a previous run that crashed
  // midway). Bounded to events that haven't started yet so old events don't
  // get rescanned forever.
  const tippedEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.status, "tipped"), gt(events.startsAt, now)));
  for (const event of tippedEvents) {
    const { succeeded, failed } = await chargeTippedEvent(event.id);
    result.chargesSucceeded += succeeded;
    result.chargesFailed += failed;
  }

  result.remindersSent = await sendDayBeforeReminders(now);
  return result;
}

/** Creator cancels pre-tip: everyone is released, nobody was charged. */
export async function cancelEvent(opts: {
  eventId: string;
  byUserId: string;
}): Promise<{ ok: true; released: Registration[]; event: Event } | { ok: false; error: string }> {
  const result = await db.transaction(async (tx) => {
    await lockEvent(tx, opts.eventId);
    const [event] = await tx.select().from(events).where(eq(events.id, opts.eventId));
    if (!event) return { ok: false as const, error: "Event not found" };
    if (event.creatorId !== opts.byUserId) {
      return { ok: false as const, error: "Only the creator can cancel" };
    }
    if (event.status !== "open") {
      return { ok: false as const, error: "This event has already tipped — it can't be cancelled" };
    }
    await tx.update(events).set({ status: "cancelled" }).where(eq(events.id, event.id));
    const released = await tx
      .update(registrations)
      .set({ state: "released" })
      .where(
        and(
          eq(registrations.eventId, event.id),
          inArray(registrations.state, ["reserved", "waitlisted"]),
        ),
      )
      .returning();
    return { ok: true as const, released, event: { ...event, status: "cancelled" as const } };
  });
  return result;
}

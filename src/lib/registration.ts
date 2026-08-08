import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import {
  gateSignup,
  promotionPlan,
  type ActiveCounts,
  type CompositionConfig,
  type WaitlistEntry,
} from "@/lib/composition";
import { shortId } from "@/lib/slug";

export interface JoinResult {
  ok: true;
  registration: Registration;
  state: "reserved" | "waitlisted";
  promoted: Registration[];
}
export interface JoinError {
  ok: false;
  error: string;
}

/** Serialise all composition-affecting writes for one event. */
async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`);
}

async function loadComposition(
  tx: Tx,
  event: Event,
): Promise<{ cfg: CompositionConfig; counts: ActiveCounts }> {
  const eventBuckets = await tx
    .select()
    .from(buckets)
    .where(eq(buckets.eventId, event.id))
    .orderBy(asc(buckets.sortOrder));
  const countRows = await tx
    .select({ bucketId: registrations.bucketId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, event.id),
        inArray(registrations.state, [...ACTIVE_STATES]),
      ),
    )
    .groupBy(registrations.bucketId);
  const counts: ActiveCounts = Object.fromEntries(eventBuckets.map((b) => [b.id, 0]));
  for (const row of countRows) counts[row.bucketId] = row.n;
  return {
    cfg: {
      buckets: eventBuckets.map((b) => ({ id: b.id, minSize: b.minSize, maxSize: b.maxSize })),
      maxImbalance: event.maxImbalance,
    },
    counts,
  };
}

/**
 * Promote the oldest eligible waitlisted registrations (composition.promotionPlan)
 * and mark them reserved. Caller must hold the event lock. Returns promoted rows —
 * the caller is responsible for sending "you're in" emails after commit.
 */
async function applyPromotions(tx: Tx, event: Event): Promise<Registration[]> {
  const { cfg, counts } = await loadComposition(tx, event);
  const waitlisted = await tx
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.state, "waitlisted")))
    .orderBy(asc(registrations.waitlistedAt), asc(registrations.id));

  const entries: WaitlistEntry[] = waitlisted.map((r) => ({
    registrationId: r.id,
    bucketId: r.bucketId,
    waitlistedAt: r.waitlistedAt ?? r.createdAt,
  }));
  const plan = promotionPlan(cfg, counts, entries);
  if (plan.length === 0) return [];

  const ids = plan.map((p) => p.registrationId);
  const updated = await tx
    .update(registrations)
    .set({ state: "reserved" })
    .where(inArray(registrations.id, ids))
    .returning();
  const byId = new Map(updated.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

export async function joinEvent(opts: {
  userId: string;
  eventId: string;
  bucketId: string;
  stripeSetupIntentId?: string;
  stripePaymentMethodId?: string;
}): Promise<JoinResult | JoinError> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, opts.eventId);

    const [event] = await tx.select().from(events).where(eq(events.id, opts.eventId));
    if (!event) return { ok: false as const, error: "Event not found" };
    if (event.status !== "open") return { ok: false as const, error: "This event isn't open for signups" };
    if (event.tipDeadlineAt.getTime() <= Date.now()) {
      return { ok: false as const, error: "Signups have closed for this event" };
    }

    const [existing] = await tx
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.eventId, opts.eventId), eq(registrations.userId, opts.userId)),
      );
    if (existing && !["cancelled", "released"].includes(existing.state)) {
      return { ok: false as const, error: "You're already registered for this event" };
    }

    const { cfg, counts } = await loadComposition(tx, event);
    if (!(opts.bucketId in counts)) return { ok: false as const, error: "Unknown side" };
    const state = gateSignup(cfg, counts, opts.bucketId);
    const now = new Date();

    let registration: Registration;
    if (existing) {
      const [revived] = await tx
        .update(registrations)
        .set({
          bucketId: opts.bucketId,
          state,
          waitlistedAt: state === "waitlisted" ? now : null,
          stripeSetupIntentId: opts.stripeSetupIntentId ?? existing.stripeSetupIntentId,
          stripePaymentMethodId: opts.stripePaymentMethodId ?? existing.stripePaymentMethodId,
        })
        .where(eq(registrations.id, existing.id))
        .returning();
      registration = revived;
    } else {
      const [created] = await tx
        .insert(registrations)
        .values({
          eventId: opts.eventId,
          bucketId: opts.bucketId,
          userId: opts.userId,
          state,
          manageToken: shortId(24),
          waitlistedAt: state === "waitlisted" ? now : null,
          stripeSetupIntentId: opts.stripeSetupIntentId,
          stripePaymentMethodId: opts.stripePaymentMethodId,
        })
        .returning();
      registration = created;
    }

    // A reserved signup on the lagging side can unlock older waitlisted
    // entries on the other side.
    const promoted = state === "reserved" ? await applyPromotions(tx, event) : [];

    return { ok: true as const, registration, state, promoted };
  });
}

export async function cancelRegistration(opts: {
  userId: string;
  registrationId: string;
}): Promise<{ ok: true; promoted: Registration[]; event: Event } | JoinError> {
  return db.transaction(async (tx) => {
    const [reg] = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, opts.registrationId));
    if (!reg || reg.userId !== opts.userId) {
      return { ok: false as const, error: "Registration not found" };
    }

    await lockEvent(tx, reg.eventId);

    const [event] = await tx.select().from(events).where(eq(events.id, reg.eventId));
    if (event.status !== "open") {
      // After tip the money has moved (or is moving) — no self-serve cancel in the MVP.
      return { ok: false as const, error: "This event has already tipped — cancelling is no longer possible" };
    }
    if (!["reserved", "waitlisted"].includes(reg.state)) {
      return { ok: false as const, error: "This registration can't be cancelled" };
    }

    await tx
      .update(registrations)
      .set({ state: "cancelled" })
      .where(eq(registrations.id, reg.id));

    const promoted = await applyPromotions(tx, event);
    return { ok: true as const, promoted, event };
  });
}

/** Attach a saved card to an existing registration (creator or fix-payment flows). */
export async function attachPaymentMethod(opts: {
  registrationId: string;
  stripeSetupIntentId: string;
  stripePaymentMethodId: string;
}): Promise<void> {
  await db
    .update(registrations)
    .set({
      stripeSetupIntentId: opts.stripeSetupIntentId,
      stripePaymentMethodId: opts.stripePaymentMethodId,
    })
    .where(eq(registrations.id, opts.registrationId));
}

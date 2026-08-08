import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// --- Stripe mock: tracks every PaymentIntent creation, honours idempotency keys,
// and fails for payment methods named pm_fail_* (mimicking a card decline).
const piCreations: { params: Record<string, unknown>; key: string }[] = [];
const piByKey = new Map<string, { id: string; status: string }>();
let piCounter = 0;

vi.mock("@/lib/stripe", () => ({
  stripeEnabled: () => true,
  ensureStripeCustomer: async () => "cus_mock",
  getStripe: () => ({
    paymentIntents: {
      create: async (
        params: { payment_method: string },
        opts: { idempotencyKey: string },
      ) => {
        const cached = piByKey.get(opts.idempotencyKey);
        if (cached) return cached;
        piCreations.push({ params, key: opts.idempotencyKey });
        if (params.payment_method.startsWith("pm_fail")) {
          const pi = { id: `pi_mock_${++piCounter}`, status: "requires_payment_method" };
          piByKey.set(opts.idempotencyKey, pi);
          const err = Object.assign(new Error("Your card was declined."), {
            payment_intent: pi,
          });
          throw err;
        }
        const pi = { id: `pi_mock_${++piCounter}`, status: "succeeded" };
        piByKey.set(opts.idempotencyKey, pi);
        return pi;
      },
      cancel: async () => ({}),
    },
  }),
}));

import { db, buckets, charges, emailLog, events, registrations, users, type Event } from "@/db";
import { shortId } from "@/lib/slug";
import { chargeRegistration } from "@/lib/payments";
import { cancelEvent, runTipper } from "@/lib/tipper";

const hasDb = Boolean(process.env.DATABASE_URL);
const createdEventIds: string[] = [];
const createdUserIds: string[] = [];

async function seedTippableEvent(opts: {
  sideA: number;
  sideB: number;
  deadlinePast?: boolean;
  failFor?: number[]; // indexes (across all regs) that get a failing payment method
}): Promise<{ event: Event; regIds: string[] }> {
  const [creator] = await db
    .insert(users)
    .values({ email: `tip-creator-${shortId(6)}@test.tipped.local`, stripeCustomerId: "cus_mock" })
    .returning();
  createdUserIds.push(creator.id);
  const [event] = await db
    .insert(events)
    .values({
      creatorId: creator.id,
      slug: `tip-${shortId(6)}`,
      title: "Tipper test",
      city: "Testville",
      venueName: "Test Bar",
      venueAddress: "1 Test St",
      startsAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      tipDeadlineAt: opts.deadlinePast
        ? new Date(Date.now() - 60_000)
        : new Date(Date.now() + 24 * 3600 * 1000),
      status: "open",
    })
    .returning();
  createdEventIds.push(event.id);
  const [a, b] = await db
    .insert(buckets)
    .values([
      { eventId: event.id, label: "Side A", priceCents: 2500, sortOrder: 0 },
      { eventId: event.id, label: "Side B", priceCents: 2500, sortOrder: 1 },
    ])
    .returning();

  const regIds: string[] = [];
  let index = 0;
  for (const [bucketId, count] of [
    [a.id, opts.sideA],
    [b.id, opts.sideB],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const [user] = await db
        .insert(users)
        .values({
          email: `tip-${shortId(8)}@test.tipped.local`,
          name: `P${index}`,
          stripeCustomerId: "cus_mock",
        })
        .returning();
      createdUserIds.push(user.id);
      const [reg] = await db
        .insert(registrations)
        .values({
          eventId: event.id,
          bucketId,
          userId: user.id,
          state: "reserved",
          manageToken: shortId(24),
          stripePaymentMethodId: opts.failFor?.includes(index) ? `pm_fail_${index}` : `pm_ok_${index}`,
        })
        .returning();
      regIds.push(reg.id);
      index++;
    }
  }
  return { event, regIds };
}

beforeEach(() => {
  piCreations.length = 0;
});

afterAll(async () => {
  if (!hasDb) return;
  if (createdEventIds.length) {
    const regs = await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(inArray(registrations.eventId, createdEventIds));
    if (regs.length) {
      await db.delete(charges).where(inArray(charges.registrationId, regs.map((r) => r.id)));
    }
    await db.delete(emailLog).where(inArray(emailLog.eventId, createdEventIds));
    await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
    await db.delete(buckets).where(inArray(buckets.eventId, createdEventIds));
    await db.delete(events).where(inArray(events.id, createdEventIds));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe.skipIf(!hasDb)("tipper (Neon integration, mocked Stripe)", () => {
  it("charges a satisfied event exactly once per reserved registration, even when rerun", async () => {
    const { event, regIds } = await seedTippableEvent({ sideA: 6, sideB: 6, deadlinePast: true });

    const first = await runTipper();
    expect(first.tipped).toContain(event.id);

    const [tippedEvent] = await db.select().from(events).where(eq(events.id, event.id));
    expect(tippedEvent.status).toBe("tipped");

    const regRows = await db
      .select()
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(regRows.every((r) => r.state === "confirmed")).toBe(true);

    const chargeRows = await db
      .select()
      .from(charges)
      .where(inArray(charges.registrationId, regIds));
    expect(chargeRows).toHaveLength(12);
    expect(chargeRows.every((c) => c.status === "succeeded")).toBe(true);

    const creationsAfterFirst = piCreations.length;
    expect(creationsAfterFirst).toBe(12);

    // Rerun: zero new PaymentIntents, zero new charge rows, no duplicate emails
    await runTipper();
    expect(piCreations).toHaveLength(creationsAfterFirst);
    const chargeRowsAfter = await db
      .select()
      .from(charges)
      .where(inArray(charges.registrationId, regIds));
    expect(chargeRowsAfter).toHaveLength(12);

    const receipts = await db
      .select()
      .from(emailLog)
      .where(eq(emailLog.eventId, event.id));
    expect(receipts.filter((e) => e.type === "tipped_receipt")).toHaveLength(12);
  });

  it("fizzles an unsatisfied event: zero PaymentIntents, everyone released, fizzle emails", async () => {
    const { event } = await seedTippableEvent({ sideA: 5, sideB: 6, deadlinePast: true });

    const result = await runTipper();
    expect(result.fizzled).toContain(event.id);
    expect(piCreations).toHaveLength(0);

    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row.status).toBe("fizzled");

    const regRows = await db
      .select()
      .from(registrations)
      .where(eq(registrations.eventId, event.id));
    expect(regRows.every((r) => r.state === "released")).toBe(true);

    const emails = await db.select().from(emailLog).where(eq(emailLog.eventId, event.id));
    expect(emails.filter((e) => e.type === "fizzled")).toHaveLength(11);
  });

  it("refuses to charge unless the event is tipped", async () => {
    const { event, regIds } = await seedTippableEvent({ sideA: 1, sideB: 1 });
    const [reg] = await db.select().from(registrations).where(eq(registrations.id, regIds[0]));
    await expect(chargeRegistration(event, reg)).rejects.toThrow(/not tipped/);
    expect(piCreations).toHaveLength(0);
  });

  it("a failed charge sends the fix email and is retryable with a new key; success confirms", async () => {
    const { event, regIds } = await seedTippableEvent({
      sideA: 6,
      sideB: 6,
      deadlinePast: true,
      failFor: [0],
    });

    await runTipper();

    const [failedReg] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, regIds[0]));
    expect(failedReg.state).toBe("reserved"); // not confirmed
    const failedCharges = await db
      .select()
      .from(charges)
      .where(eq(charges.registrationId, failedReg.id));
    expect(failedCharges).toHaveLength(1);
    expect(failedCharges[0].status).toBe("failed");

    const fixEmails = await db
      .select()
      .from(emailLog)
      .where(eq(emailLog.registrationId, failedReg.id));
    expect(fixEmails.filter((e) => e.type === "charge_failed")).toHaveLength(1);

    // Fix the card, then retry — new PI under a retry idempotency key
    await db
      .update(registrations)
      .set({ stripePaymentMethodId: "pm_ok_fixed" })
      .where(eq(registrations.id, failedReg.id));
    const [fixedReg] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, failedReg.id));
    const [tippedEvent] = await db.select().from(events).where(eq(events.id, event.id));
    const outcome = await chargeRegistration(tippedEvent, fixedReg);
    expect(outcome.status).toBe("succeeded");
    expect(piCreations.at(-1)?.key).toBe(`tip-${failedReg.id}-retry-1`);
  });

  it("creator cancel pre-tip releases everyone with zero charges", async () => {
    const { event } = await seedTippableEvent({ sideA: 3, sideB: 2 });

    const result = await cancelEvent({ eventId: event.id, byUserId: event.creatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.released).toHaveLength(5);
    expect(piCreations).toHaveLength(0);

    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row.status).toBe("cancelled");

    // Non-creator can't cancel
    const { event: other } = await seedTippableEvent({ sideA: 1, sideB: 1 });
    const denied = await cancelEvent({ eventId: other.id, byUserId: event.creatorId });
    expect(denied.ok).toBe(false);
  });
});

import Stripe from "stripe";
import { asc, eq } from "drizzle-orm";
import {
  db,
  buckets,
  charges,
  users,
  type Charge,
  type Event,
  type Registration,
} from "@/db";
import { ensureStripeCustomer, getStripe, stripeEnabled } from "@/lib/stripe";

export interface ChargeOutcome {
  status: "succeeded" | "requires_action" | "failed";
  charge: Charge;
}

/**
 * THE ONLY code path allowed to create Stripe PaymentIntents (iron rule).
 * Throws unless the event is tipped. Idempotent:
 *  - a non-failed charge row for the registration short-circuits;
 *  - the Stripe idempotency key is `tip-{registrationId}` (retries after a
 *    failure get `tip-{registrationId}-retry-{n}`);
 *  - charge rows are append-only and unique on payment intent id.
 */
export async function chargeRegistration(
  event: Event,
  registration: Registration,
): Promise<ChargeOutcome> {
  if (event.status !== "tipped") {
    throw new Error("Refusing to charge: event is not tipped");
  }
  if (registration.eventId !== event.id) {
    throw new Error("Registration does not belong to this event");
  }

  const existing = await db
    .select()
    .from(charges)
    .where(eq(charges.registrationId, registration.id))
    .orderBy(asc(charges.createdAt));
  const open = existing.find((c) => c.status !== "failed");
  if (open) {
    return {
      status: open.status === "succeeded" ? "succeeded" : open.status === "requires_action" ? "requires_action" : "failed",
      charge: open,
    };
  }
  const attempt = existing.length;

  const [bucket] = await db.select().from(buckets).where(eq(buckets.id, registration.bucketId));
  if (!bucket) throw new Error("Bucket not found for registration");

  if (!stripeEnabled()) {
    // Keyless local dev: simulate an instant success so the lifecycle is demoable.
    const [row] = await db
      .insert(charges)
      .values({
        registrationId: registration.id,
        stripePaymentIntentId: `dev_pi_${registration.id}_${attempt}`,
        amountCents: bucket.priceCents,
        status: "succeeded",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return chargeRegistration(event, registration); // lost a race; re-read
    return { status: "succeeded", charge: row };
  }

  if (!registration.stripePaymentMethodId) {
    const [row] = await db
      .insert(charges)
      .values({ registrationId: registration.id, amountCents: bucket.priceCents, status: "failed" })
      .returning();
    return { status: "failed", charge: row };
  }

  const [user] = await db.select().from(users).where(eq(users.id, registration.userId));
  const customerId = user.stripeCustomerId ?? (await ensureStripeCustomer(user));
  const idempotencyKey = attempt === 0 ? `tip-${registration.id}` : `tip-${registration.id}-retry-${attempt}`;

  let pi: Stripe.PaymentIntent | null = null;
  let errorPi: Stripe.PaymentIntent | null = null;
  try {
    pi = await getStripe().paymentIntents.create(
      {
        amount: bucket.priceCents,
        currency: "aud",
        customer: customerId,
        payment_method: registration.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { registrationId: registration.id, eventId: event.id },
      },
      { idempotencyKey },
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError && err.payment_intent) {
      errorPi = err.payment_intent;
    } else if (err instanceof Error && "payment_intent" in err) {
      errorPi = (err as { payment_intent: Stripe.PaymentIntent }).payment_intent;
    } else {
      throw err;
    }
  }

  const intent = pi ?? errorPi;
  const status: Charge["status"] =
    intent?.status === "succeeded"
      ? "succeeded"
      : intent?.status === "requires_action"
        ? "requires_action"
        : "failed";

  const [row] = await db
    .insert(charges)
    .values({
      registrationId: registration.id,
      stripePaymentIntentId: intent?.id ?? null,
      amountCents: bucket.priceCents,
      status,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return chargeRegistration(event, registration); // webhook or rerun beat us

  return { status: status === "succeeded" ? "succeeded" : status === "requires_action" ? "requires_action" : "failed", charge: row };
}

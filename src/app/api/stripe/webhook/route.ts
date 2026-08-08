import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db, charges, events, registrations } from "@/db";
import { sendChargeFailedEmail, sendTippedReceiptEmail } from "@/lib/notifications";
import { getStripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = getStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (
    stripeEvent.type === "payment_intent.succeeded" ||
    stripeEvent.type === "payment_intent.payment_failed" ||
    stripeEvent.type === "payment_intent.requires_action"
  ) {
    const pi = stripeEvent.data.object;
    const [charge] = await db
      .select()
      .from(charges)
      .where(eq(charges.stripePaymentIntentId, pi.id));
    if (!charge) return NextResponse.json({ received: true }); // not one of ours

    const [reg] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, charge.registrationId));
    const [event] = await db.select().from(events).where(eq(events.id, reg.eventId));

    if (stripeEvent.type === "payment_intent.succeeded") {
      await db.update(charges).set({ status: "succeeded" }).where(eq(charges.id, charge.id));
      await db
        .update(registrations)
        .set({ state: "confirmed" })
        .where(and(eq(registrations.id, reg.id), eq(registrations.state, "reserved")));
      await sendTippedReceiptEmail(event, reg, charge.amountCents);
    } else if (stripeEvent.type === "payment_intent.requires_action") {
      await db.update(charges).set({ status: "requires_action" }).where(eq(charges.id, charge.id));
      await sendChargeFailedEmail(event, reg);
    } else {
      await db.update(charges).set({ status: "failed" }).where(eq(charges.id, charge.id));
      await sendChargeFailedEmail(event, reg);
    }
  }

  return NextResponse.json({ received: true });
}

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, events, registrations } from "@/db";
import { sendTippedReceiptEmail } from "@/lib/notifications";
import { chargeRegistration } from "@/lib/payments";
import { attachPaymentMethod } from "@/lib/registration";
import { getStripe, stripeEnabled } from "@/lib/stripe";

const bodySchema = z.object({ setupIntentId: z.string().optional() });

/** Fix-payment step 2: attach the fresh card and retry the charge. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [reg] = await db.select().from(registrations).where(eq(registrations.manageToken, token));
  if (!reg) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const [event] = await db.select().from(events).where(eq(events.id, reg.eventId));
  if (event.status !== "tipped") {
    return NextResponse.json({ error: "There's nothing to pay for right now" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  let current = reg;
  if (stripeEnabled()) {
    if (!parsed.data.setupIntentId) {
      return NextResponse.json({ error: "Missing card setup" }, { status: 400 });
    }
    const si = await getStripe().setupIntents.retrieve(parsed.data.setupIntentId);
    if (si.status !== "succeeded" || si.metadata?.registrationId !== reg.id) {
      return NextResponse.json({ error: "Card setup incomplete" }, { status: 400 });
    }
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    if (!pm) return NextResponse.json({ error: "No card found" }, { status: 400 });
    await attachPaymentMethod({
      registrationId: reg.id,
      stripeSetupIntentId: si.id,
      stripePaymentMethodId: pm,
    });

    // A new card supersedes any stuck requires_action/pending attempt: cancel
    // it on Stripe (best effort) and mark it failed so chargeRegistration's
    // short-circuit doesn't block the retry.
    const { charges } = await import("@/db");
    const stale = await db
      .select()
      .from(charges)
      .where(eq(charges.registrationId, reg.id));
    for (const c of stale) {
      if (c.status === "requires_action" || c.status === "pending") {
        if (c.stripePaymentIntentId) {
          await getStripe()
            .paymentIntents.cancel(c.stripePaymentIntentId)
            .catch(() => undefined);
        }
        await db.update(charges).set({ status: "failed" }).where(eq(charges.id, c.id));
      }
    }

    const [reloaded] = await db.select().from(registrations).where(eq(registrations.id, reg.id));
    current = reloaded;
  }

  const outcome = await chargeRegistration(event, current);
  if (outcome.status === "succeeded") {
    await db
      .update(registrations)
      .set({ state: "confirmed" })
      .where(and(eq(registrations.id, current.id), eq(registrations.state, "reserved")));
    await sendTippedReceiptEmail(event, current, outcome.charge.amountCents);
    return NextResponse.json({ status: "succeeded" });
  }
  return NextResponse.json({ status: outcome.status });
}

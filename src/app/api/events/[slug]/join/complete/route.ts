import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { sendSignupEmails } from "@/lib/notifications";
import { joinEvent } from "@/lib/registration";
import { getStripe, stripeEnabled } from "@/lib/stripe";

const bodySchema = z.object({
  bucketId: z.string().uuid(),
  setupIntentId: z.string().optional(),
});

/**
 * Step 2 of joining: card is saved (or dev mode) — run the gated signup
 * transaction and land as reserved or waitlisted.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.name || !user.photoUrl) {
    return NextResponse.json({ error: "Complete your profile first" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  let setupIntentId: string | undefined;
  let paymentMethodId: string | undefined;

  if (stripeEnabled()) {
    if (!parsed.data.setupIntentId) {
      return NextResponse.json({ error: "Missing card setup" }, { status: 400 });
    }
    const si = await getStripe().setupIntents.retrieve(parsed.data.setupIntentId);
    if (si.status !== "succeeded" || si.metadata?.userId !== user.id) {
      return NextResponse.json({ error: "Card setup incomplete" }, { status: 400 });
    }
    setupIntentId = si.id;
    paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  }

  const result = await joinEvent({
    userId: user.id,
    eventId: event.id,
    bucketId: parsed.data.bucketId,
    stripeSetupIntentId: setupIntentId,
    stripePaymentMethodId: paymentMethodId,
  });

  if (!result.ok) {
    // Already registered? Surface current state instead of an error so the
    // done page is refresh-safe.
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  await sendSignupEmails(event, result.registration, result.state, result.promoted);
  return NextResponse.json({ state: result.state });
}

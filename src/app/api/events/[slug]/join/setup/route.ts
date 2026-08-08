import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { ensureStripeCustomer, getStripe, stripeEnabled } from "@/lib/stripe";

const bodySchema = z.object({
  bucketId: z.string().uuid(),
  acceptConduct: z.boolean().optional(),
});

/**
 * Step 1 of joining: record conduct acceptance and (if Stripe is configured)
 * create the SetupIntent for saving the card. No registration exists yet —
 * that happens in /join/complete after the card is saved, inside the gate
 * transaction.
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
  if (event.status !== "open" || event.tipDeadlineAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Signups have closed" }, { status: 400 });
  }

  if (!user.acceptedConductAt) {
    if (!parsed.data.acceptConduct) {
      return NextResponse.json({ error: "Please accept the code of conduct" }, { status: 400 });
    }
    await db
      .update(users)
      .set({ acceptedConductAt: new Date() })
      .where(eq(users.id, user.id));
  }

  if (!stripeEnabled()) {
    return NextResponse.json({ mode: "dev" });
  }

  const customerId = await ensureStripeCustomer(user);
  const setupIntent = await getStripe().setupIntents.create({
    customer: customerId,
    usage: "off_session",
    metadata: { userId: user.id, eventId: event.id, bucketId: parsed.data.bucketId },
  });
  return NextResponse.json({
    mode: "stripe",
    clientSecret: setupIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
}

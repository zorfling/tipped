import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, registrations, users } from "@/db";
import { ensureStripeCustomer, getStripe, stripeEnabled } from "@/lib/stripe";

/** Fix-payment step 1: new SetupIntent to save a working card. Token-authed. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [reg] = await db.select().from(registrations).where(eq(registrations.manageToken, token));
  if (!reg) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  if (!stripeEnabled()) return NextResponse.json({ mode: "dev" });

  const [user] = await db.select().from(users).where(eq(users.id, reg.userId));
  const customerId = await ensureStripeCustomer(user);
  const setupIntent = await getStripe().setupIntents.create({
    customer: customerId,
    usage: "off_session",
    metadata: { userId: user.id, registrationId: reg.id, purpose: "fix_payment" },
  });
  return NextResponse.json({
    mode: "stripe",
    clientSecret: setupIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
}

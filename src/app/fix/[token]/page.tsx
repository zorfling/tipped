import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, charges, events, registrations } from "@/db";
import { FixClient } from "./fix-client";

export const dynamic = "force-dynamic";

export default async function FixPaymentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [reg] = await db.select().from(registrations).where(eq(registrations.manageToken, token));
  if (!reg) notFound();
  const [event] = await db.select().from(events).where(eq(events.id, reg.eventId));
  const regCharges = await db
    .select()
    .from(charges)
    .where(eq(charges.registrationId, reg.id))
    .orderBy(asc(charges.createdAt));
  const settled = reg.state === "confirmed" || regCharges.some((c) => c.status === "succeeded");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{event.title}</h1>
      {settled ? (
        <p className="mt-4 text-sm">
          ✅ Your payment is sorted — nothing to do. See you on the night!
        </p>
      ) : event.status !== "tipped" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          There&apos;s nothing to pay right now — this event{" "}
          {event.status === "open" ? "hasn't tipped yet" : `is ${event.status}`}. You&apos;re
          only ever charged once an event tips.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            The event tipped but your card payment didn&apos;t go through. Save a working
            card and we&apos;ll retry — sort it within 24 hours of the original email to keep
            your spot.
          </p>
          <FixClient token={token} />
        </>
      )}
    </main>
  );
}

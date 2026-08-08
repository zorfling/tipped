import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, events } from "@/db";
import { getSessionUserId } from "@/lib/auth";
import { ManageForms } from "./manage-forms";

export const dynamic = "force-dynamic";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await getSessionUserId();
  if (!userId) redirect(`/login?next=/e/${slug}/manage`);
  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  if (!event || event.creatorId !== userId) notFound();
  if (event.status !== "open") redirect(`/e/${slug}`);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Manage event</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You can edit details, extend the deadline once, or cancel — but only until it tips.
        After that you&apos;re an attendee like everyone else.
      </p>
      <ManageForms
        slug={slug}
        initial={{
          title: event.title,
          venueName: event.venueName,
          venueAddress: event.venueAddress,
          venueNotes: event.venueNotes ?? "",
        }}
        deadline={event.tipDeadlineAt.toISOString()}
        alreadyExtended={Boolean(event.deadlineExtendedAt)}
      />
    </main>
  );
}

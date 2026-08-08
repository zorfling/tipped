import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { EventLive } from "./event-live";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const userId = await getSessionUserId();
  const isCreator = userId === event.creatorId;

  const when = event.startsAt.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="text-2xl font-semibold">{event.title}</h1>
      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        <p>{when}</p>
        <p>
          {event.venueName} · {event.venueAddress} · {event.city}
        </p>
        {event.venueNotes && <p className="italic">“{event.venueNotes}”</p>}
      </div>
      {isCreator && event.status === "open" && (
        <p className="mt-2 text-sm">
          <Link href={`/e/${slug}/manage`} className="underline underline-offset-2">
            Manage your event
          </Link>
        </p>
      )}

      <EventLive slug={slug} />

      <div className="mt-8 rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">How Tipped works</p>
        <p className="mt-1">
          This night only happens if both sides fill to their minimum, roughly balanced, by
          the deadline. Your card is saved when you join but{" "}
          <span className="font-medium text-foreground">
            you&apos;re only charged if it goes ahead
          </span>
          . If it doesn&apos;t tip, nobody pays and nobody turns up to an empty bar.
        </p>
      </div>
    </main>
  );
}

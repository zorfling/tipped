import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { Wordmark } from "@/components/wordmark";
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
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <nav className="mb-8">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
      </nav>
      <div className="lg:grid lg:grid-cols-[1fr_minmax(24rem,26rem)] lg:items-start lg:gap-12">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-candle">
            {event.city}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">{event.title}</h1>
          <div className="mt-3 space-y-1 text-sm text-muted-foreground sm:text-base">
            <p>{when}</p>
            <p>
              {event.venueName} · {event.venueAddress} · {event.city}
            </p>
            {event.venueNotes && <p className="italic">“{event.venueNotes}”</p>}
          </div>
          {isCreator && event.status === "open" && (
            <p className="mt-3 text-sm">
              <Link href={`/e/${slug}/manage`} className="underline underline-offset-2">
                Manage your event
              </Link>
            </p>
          )}

          <div className="mt-8 hidden rounded-xl border bg-card p-4 text-xs leading-relaxed text-muted-foreground lg:block">
            <p className="font-heading text-sm font-semibold text-foreground">How Tipped works</p>
            <p className="mt-1">
              This night only happens if both sides fill to their minimum, roughly balanced,
              by the deadline. Your card is saved when you join but{" "}
              <span className="font-medium text-foreground">
                you&apos;re only charged if it goes ahead
              </span>
              . If it doesn&apos;t tip, nobody pays and nobody turns up to an empty bar.
            </p>
          </div>
        </div>

        <div>
          <EventLive slug={slug} />
        </div>
      </div>

      <div className="mt-8 rounded-xl border bg-card p-4 text-xs leading-relaxed text-muted-foreground lg:hidden">
        <p className="font-heading text-sm font-semibold text-foreground">How Tipped works</p>
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

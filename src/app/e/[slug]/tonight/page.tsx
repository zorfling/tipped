import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { TonightClient } from "./tonight-client";

export const dynamic = "force-dynamic";

export default async function TonightPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await getSessionUserId();
  if (!userId) redirect(`/login?next=/e/${slug}/tonight`);
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-candle">Tonight</p>
        <h1 className="mt-1 text-xl font-bold">{event.title}</h1>
        <p className="text-sm text-muted-foreground">
          {event.venueName}
          {event.venueNotes ? ` — ${event.venueNotes}` : ""}
        </p>
      </header>
      <TonightClient slug={slug} />
    </main>
  );
}

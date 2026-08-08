import { notFound, redirect } from "next/navigation";
import { and, eq, or } from "drizzle-orm";
import { db, matches, registrations, users } from "@/db";
import { getSessionUserId } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { MatchList } from "./match-list";

export const dynamic = "force-dynamic";

export default async function MatchesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await getSessionUserId();
  if (!userId) redirect(`/login?next=/e/${slug}/matches`);
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const [myReg] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.userId, userId)));
  if (!myReg) notFound();

  const myMatches = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.eventId, event.id),
        or(eq(matches.registrationAId, myReg.id), eq(matches.registrationBId, myReg.id)),
      ),
    );

  // Only revealed matches are shown — the morning email is the reveal moment.
  const revealed = myMatches.filter((m) => m.revealedAt !== null);
  const partnerRegIds = revealed.map((m) =>
    m.registrationAId === myReg.id ? m.registrationBId : m.registrationAId,
  );

  const partners =
    partnerRegIds.length > 0
      ? await db
          .select({
            registrationId: registrations.id,
            name: users.name,
            photoUrl: users.photoUrl,
            email: users.email,
          })
          .from(registrations)
          .innerJoin(users, eq(registrations.userId, users.id))
          .where(or(...partnerRegIds.map((id) => eq(registrations.id, id))))
      : [];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Your matches</h1>
      <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>
      {event.status !== "matched" ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Matches aren&apos;t out yet — they&apos;re revealed the morning after the event.
        </p>
      ) : partners.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No mutual matches this time{revealed.length === 0 && myMatches.length === 0 ? " — it happens" : ""}.
          Nobody sees one-sided picks, ever. There&apos;s always another night.
        </p>
      ) : (
        <MatchList slug={slug} partners={partners} />
      )}
    </main>
  );
}

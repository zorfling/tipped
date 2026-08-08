import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, buckets, registrations } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { ProfileForm } from "@/components/profile-form";
import { JoinFlow } from "./join-flow";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ slug: string; bucketId: string }>;
}) {
  const { slug, bucketId } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const [bucket] = await db.select().from(buckets).where(eq(buckets.id, bucketId));
  if (!bucket || bucket.eventId !== event.id) notFound();

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/e/${slug}/join/${bucketId}`);

  if (event.status !== "open" || event.tipDeadlineAt.getTime() <= Date.now()) {
    redirect(`/e/${slug}`);
  }

  const [existing] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.userId, user.id)));
  if (existing && !["cancelled", "released"].includes(existing.state)) {
    redirect(`/e/${slug}/join/${bucketId}/done?already=1`);
  }

  if (!user.name || !user.photoUrl) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold">First, your profile</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          A name and photo are required to join — on the night, your matches find you by
          your photo.
        </p>
        <ProfileForm
          initialName={user.name ?? ""}
          initialPhotoUrl={user.photoUrl}
          submitLabel="Save and continue"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="text-2xl font-semibold">Join {event.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {bucket.label} · ${(bucket.priceCents / 100).toFixed(0)} — only charged if it goes
        ahead
      </p>
      <JoinFlow
        slug={slug}
        bucketId={bucketId}
        bucketLabel={bucket.label}
        priceCents={bucket.priceCents}
        needsConduct={!user.acceptedConductAt}
      />
    </main>
  );
}

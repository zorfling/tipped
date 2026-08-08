import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, events, registrations, buckets } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CancelButton } from "./cancel-button";

const stateLabels: Record<string, string> = {
  reserved: "Reserved — charged only if it tips",
  waitlisted: "Waitlisted",
  confirmed: "Confirmed",
  released: "Released (event fizzled)",
  refunded: "Refunded",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  no_show: "No-show",
};

export default async function MePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me");

  const myRegs = await db
    .select({
      registration: registrations,
      event: events,
      bucket: buckets,
    })
    .from(registrations)
    .innerJoin(events, eq(registrations.eventId, events.id))
    .innerJoin(buckets, eq(registrations.bucketId, buckets.id))
    .where(eq(registrations.userId, user.id))
    .orderBy(desc(events.startsAt));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your profile</h1>
        <form action="/api/auth/logout" method="post">
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
      <div className="md:grid md:grid-cols-[minmax(0,20rem)_1fr] md:gap-12">
      <ProfileForm initialName={user.name ?? ""} initialPhotoUrl={user.photoUrl} />

      <div>
      <h2 className="mb-3 mt-10 text-lg font-semibold md:mt-0">Your events</h2>
      {myRegs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet.{" "}
          <Link className="underline" href="/">
            Find an event
          </Link>{" "}
          or{" "}
          <Link className="underline" href="/create">
            create one
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {myRegs.map(({ registration, event, bucket }) => (
            <li key={registration.id} className="rounded-lg border bg-card p-4">
              <Link
                href={`/e/${event.slug}`}
                className="font-heading text-base font-semibold underline-offset-2 hover:underline"
              >
                {event.title}
              </Link>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {event.city} ·{" "}
                {event.startsAt.toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}{" "}
                · {bucket.label}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Badge variant="secondary">
                  {stateLabels[registration.state] ?? registration.state}
                </Badge>
                {event.status === "open" &&
                  ["reserved", "waitlisted"].includes(registration.state) && (
                    <CancelButton registrationId={registration.id} />
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
      </div>
    </main>
  );
}

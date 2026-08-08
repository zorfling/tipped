import Link from "next/link";
import { getOpenEvents } from "@/lib/events";
import { getSessionUser } from "@/lib/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city } = await searchParams;
  const [openEvents, user] = await Promise.all([getOpenEvents(city), getSessionUser()]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tipped</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Speed dating that only happens if enough people commit. No organiser, no host —
            the app runs the night.
          </p>
        </div>
        <Link href={user ? "/me" : "/login"} className="text-sm underline underline-offset-2">
          {user ? "Profile" : "Sign in"}
        </Link>
      </header>

      <div className="mb-6 flex gap-2">
        <form className="flex flex-1 gap-2" action="/">
          <Input name="city" placeholder="Filter by city" defaultValue={city ?? ""} />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        <Link href="/create" className={buttonVariants()}>
          Create
        </Link>
      </div>

      {openEvents.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>No open events{city ? ` in “${city}”` : ""} right now.</p>
          <p className="mt-2">
            <Link href="/create" className="underline">
              Start one
            </Link>{" "}
            — you just need to show up like everyone else.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {openEvents.map((event) => (
            <li key={event.id}>
              <Link
                href={`/e/${event.slug}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="font-medium">{event.title}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {event.city} · {event.venueName} ·{" "}
                  {event.startsAt.toLocaleString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

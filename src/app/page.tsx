import Link from "next/link";
import { getOpenEvents } from "@/lib/events";
import { getSessionUser } from "@/lib/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/wordmark";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city } = await searchParams;
  const [openEvents, user] = await Promise.all([getOpenEvents(city), getSessionUser()]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <nav className="mb-12 flex items-center justify-between">
        <Wordmark className="text-2xl" />
        <Link
          href={user ? "/me" : "/login"}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {user ? "Profile" : "Sign in"}
        </Link>
      </nav>

      <header className="mb-12 max-w-2xl lg:mb-16">
        <h1 className="font-heading text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          Speed dating that only happens{" "}
          <span className="text-gradient-flame">if it tips.</span>
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          Anyone can start a night. It runs only if enough people join both sides — and
          your card is only charged if it does. No organiser, no host, no empty bar.
        </p>
      </header>

      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex flex-1 gap-2 sm:max-w-sm" action="/">
          <Input name="city" placeholder="Filter by city" defaultValue={city ?? ""} />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        <Link href="/create" className={buttonVariants()}>
          Start a night
        </Link>
      </div>

      {openEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          <p>No open nights{city ? ` in “${city}”` : ""} right now.</p>
          <p className="mt-2">
            <Link href="/create" className="text-candle underline underline-offset-4">
              Start one
            </Link>{" "}
            — you just show up like everyone else.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {openEvents.map((event) => (
            <li key={event.id}>
              <Link
                href={`/e/${event.slug}`}
                className="flex h-full flex-col rounded-xl border bg-card p-5 transition-colors hover:border-candle/40"
              >
                <div className="font-heading text-lg font-semibold leading-snug">
                  {event.title}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {event.city} · {event.venueName}
                </div>
                <div className="mt-auto pt-3 text-sm font-medium text-candle">
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

      <footer className="mt-16 grid gap-6 border-t pt-8 text-sm leading-relaxed text-muted-foreground sm:grid-cols-3">
        <div>
          <p className="font-heading font-semibold text-foreground">1 · Pick a side</p>
          <p className="mt-1">
            Join with a name, a photo, and a saved card. You&apos;re charged nothing yet.
          </p>
        </div>
        <div>
          <p className="font-heading font-semibold text-foreground">2 · It tips or it doesn&apos;t</p>
          <p className="mt-1">
            If both sides fill by the deadline, everyone&apos;s charged and it&apos;s on. If not,
            it fizzles and nobody pays.
          </p>
        </div>
        <div>
          <p className="font-heading font-semibold text-foreground">3 · Your phone runs the night</p>
          <p className="mt-1">
            Each round shows who you&apos;re meeting. Mutual yeses land in your inbox the
            next morning.
          </p>
        </div>
      </footer>
    </main>
  );
}

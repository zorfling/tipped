import Link from "next/link";
import { getOpenEvents } from "@/lib/events";
import { getSessionUser } from "@/lib/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city } = await searchParams;
  const [openEvents, user] = await Promise.all([getOpenEvents(city), getSessionUser()]);

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-12 pt-8">
      <nav className="mb-10 flex items-center justify-between">
        <Wordmark className="text-2xl" />
        <Link
          href={user ? "/me" : "/login"}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {user ? "Profile" : "Sign in"}
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="font-heading text-4xl font-bold leading-[1.05] tracking-tight">
          Speed dating that only happens{" "}
          <span className="text-gradient-flame">if it tips.</span>
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Anyone can start a night. It runs only if enough people join both sides — and
          your card is only charged if it does. No organiser, no host, no empty bar.
        </p>
      </header>

      <div className="mb-8 flex gap-2">
        <form className="flex flex-1 gap-2" action="/">
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
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>No open nights{city ? ` in “${city}”` : ""} right now.</p>
          <p className="mt-2">
            <Link href="/create" className="text-candle underline underline-offset-4">
              Start one
            </Link>{" "}
            — you just show up like everyone else.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {openEvents.map((event) => (
            <li key={event.id}>
              <Link
                href={`/e/${event.slug}`}
                className="block rounded-xl border bg-card p-4 transition-colors hover:border-candle/40"
              >
                <div className="font-heading text-lg font-semibold">{event.title}</div>
                <div className={cn("mt-1 text-sm text-muted-foreground")}>
                  {event.city} · {event.venueName}
                </div>
                <div className="mt-2 text-sm font-medium text-candle">
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

      <footer className="mt-14 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">How it works:</span> pick a side
          and save your card — you&apos;re charged nothing. If both sides fill by the
          deadline, the night tips: everyone&apos;s charged, everyone shows. On the night
          your phone shows who you&apos;re meeting each round. Mutual yeses land in your
          inbox the next morning.
        </p>
      </footer>
    </main>
  );
}

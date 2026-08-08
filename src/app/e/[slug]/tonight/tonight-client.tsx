"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { NightStatePayload } from "@/lib/nightState";

const POLL_MS = 5_000;

function useTicker(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return Date.now();
}

function mmss(target: string, nowMs: number): string {
  const ms = Math.max(new Date(target).getTime() - nowMs, 0);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PartnerCard({
  partner,
  headline,
  sub,
}: {
  partner: { name: string | null; photoUrl: string | null };
  headline: string;
  sub: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {headline}
      </p>
      <div className="mt-4 size-56 overflow-hidden rounded-2xl border bg-muted shadow-md">
        {partner.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={partner.photoUrl}
            alt={partner.name ?? "Your date"}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            No photo
          </div>
        )}
      </div>
      <p className="mt-4 text-3xl font-bold">{partner.name}</p>
      <p className="mt-2 text-muted-foreground">{sub}</p>
    </div>
  );
}

export function TonightClient({ slug }: { slug: string }) {
  const [state, setState] = useState<NightStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const nowMs = useTicker();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}/state`, { cache: "no-store" });
      if (res.ok) {
        setState(await res.json());
        setError(null);
      }
    } catch {
      // transient — next poll retries
    }
  }, [slug]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function doCheckIn() {
    setCheckinBusy(true);
    const res = await fetch(`/api/events/${slug}/checkin`, { method: "POST" });
    const body = await res.json();
    setCheckinBusy(false);
    if (!res.ok) setError(body.error ?? "Couldn't check in");
    else load();
  }

  if (!state) {
    return <div className="flex-1 animate-pulse rounded-xl border bg-muted/40" />;
  }

  if (state.phase === "not_attending") {
    return (
      <p className="mt-8 text-center text-sm text-muted-foreground">
        You&apos;re not on tonight&apos;s list.{" "}
        <Link href={`/e/${slug}`} className="underline">
          Back to the event
        </Link>
      </p>
    );
  }
  if (state.phase === "cancelled") {
    return (
      <p className="mt-8 text-center text-sm">
        Tonight&apos;s event couldn&apos;t run. Check your email — we&apos;re sorry.
      </p>
    );
  }
  if (state.phase === "pre") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-muted-foreground">Check-in opens 15 minutes before start.</p>
      </div>
    );
  }

  if (!state.checkedIn && state.canCheckIn) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="mb-6 text-lg font-medium">At the venue?</p>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <Button size="lg" className="h-16 w-full max-w-xs text-xl" onClick={doCheckIn} disabled={checkinBusy}>
          {checkinBusy ? "Checking in…" : "I'm here 👋"}
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          The night starts automatically once everyone&apos;s in.
        </p>
      </div>
    );
  }

  if (state.phase === "checkin" || state.phase === "awaiting_schedule") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-2xl font-semibold">You&apos;re checked in ✓</p>
        <p className="mt-3 text-muted-foreground">
          Grab a drink — the schedule appears here the moment the night begins. No host,
          no announcements: this screen is the host.
        </p>
      </div>
    );
  }

  if (state.phase === "before_first_round" || state.phase === "break") {
    if (!state.nextRound) return null;
    if (!state.nextPartner) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-xl font-semibold">Sit this one out 🍹</p>
          <p className="mt-2 text-muted-foreground">
            You&apos;re on a break for round {state.nextRound.number}. Back after that.
          </p>
        </div>
      );
    }
    return (
      <PartnerCard
        partner={state.nextPartner}
        headline={`Next: round ${state.nextRound.number} — starts in ${mmss(state.nextRound.startsAt, nowMs)}`}
        sub="Reposition now so you can find each other."
      />
    );
  }

  if (state.phase === "round") {
    if (!state.round) return null;
    if (!state.partner) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Round {state.round.number} of {state.totalRounds}
          </p>
          <p className="mt-6 text-xl font-semibold">Sit this one out 🍹</p>
          <p className="mt-2 text-muted-foreground">
            Grab a drink — you&apos;re back next round.
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col">
        <div className="rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground">
          Round {state.round.number} of {state.totalRounds} · {mmss(state.round.endsAt, nowMs)} left
        </div>
        <PartnerCard partner={state.partner} headline="Find each other" sub="This is your date for the round." />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <p className="text-2xl font-semibold">That&apos;s a wrap 🎉</p>
      <p className="mt-3 text-muted-foreground">
        Thanks for playing. Watch your inbox tomorrow morning — mutual matches get
        revealed then.
      </p>
    </div>
  );
}

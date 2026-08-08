"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { NightStatePayload } from "@/lib/nightState";
import { useNightCues } from "./use-night-cues";

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
      <div className="glow-candle mt-5 size-60 overflow-hidden rounded-3xl bg-muted md:size-72">
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
      <p className="mt-5 font-heading text-4xl font-bold">{partner.name}</p>
      <p className="mt-2 text-muted-foreground">{sub}</p>
    </div>
  );
}

function PickButtons({
  slug,
  partner,
  onPicked,
  compact,
}: {
  slug: string;
  partner: { registrationId: string; name: string | null; myChoice: "yes" | "no" | null };
  onPicked: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function pick(choice: "yes" | "no") {
    setBusy(true);
    await fetch(`/api/events/${slug}/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toRegistrationId: partner.registrationId, choice }),
    });
    setBusy(false);
    onPicked();
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "mt-2 flex items-center justify-center gap-3"}>
      <Button
        size="sm"
        variant={partner.myChoice === "yes" ? "default" : "outline"}
        disabled={busy}
        onClick={() => pick("yes")}
      >
        👍 Yes
      </Button>
      <Button
        size="sm"
        variant={partner.myChoice === "no" ? "default" : "outline"}
        disabled={busy}
        onClick={() => pick("no")}
      >
        👎 No
      </Button>
    </div>
  );
}

function ReportLink({
  slug,
  registrationId,
}: {
  slug: string;
  registrationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  if (state === "sent") {
    return <p className="mt-3 text-center text-xs text-muted-foreground">Report sent — thank you.</p>;
  }
  if (!open) {
    return (
      <button
        className="mt-3 w-full text-center text-xs text-muted-foreground underline"
        onClick={() => setOpen(true)}
      >
        Report a problem with this person
      </button>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <textarea
        className="min-h-20 rounded-md border bg-background p-2 text-sm"
        placeholder="What happened? This goes straight to us."
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button
        size="sm"
        variant="destructive"
        disabled={!body.trim() || state === "sending"}
        onClick={async () => {
          setState("sending");
          await fetch(`/api/events/${slug}/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportedRegistrationId: registrationId, body }),
          });
          setState("sent");
        }}
      >
        Send report
      </Button>
    </div>
  );
}

export function TonightClient({ slug }: { slug: string }) {
  const [state, setState] = useState<NightStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const nowMs = useTicker();
  useNightCues(state);

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
    // The schedule generates 10 min after starts_at (late-arrival grace).
    const nightStartsMs = new Date(state.startsAt).getTime() + 10 * 60 * 1000;
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-2xl font-semibold">You&apos;re checked in ✓</p>
        {nightStartsMs > nowMs ? (
          <p className="mt-6 font-heading text-5xl font-bold tabular-nums text-candle">
            {mmss(new Date(nightStartsMs).toISOString(), nowMs)}
          </p>
        ) : (
          <p className="mt-6 font-heading text-2xl font-bold text-candle">Any moment now…</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">until the first round</p>
        <p className="mt-5 text-muted-foreground">
          Grab a drink — your first date&apos;s photo appears here the moment the night
          begins. No host, no announcements: this screen is the host.
        </p>
      </div>
    );
  }

  if (state.phase === "before_first_round" || state.phase === "break") {
    if (!state.nextRound) return null;
    const justMet = state.pastPartners?.at(-1);
    const pickPrompt = justMet && (
      <div className="mt-auto rounded-lg border bg-muted/40 p-3">
        <p className="text-center text-sm font-medium">How was {justMet.name}?</p>
        <PickButtons slug={slug} partner={justMet} onPicked={load} />
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Private — only mutual yeses are ever revealed.
        </p>
      </div>
    );
    if (!state.nextPartner) {
      return (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-xl font-semibold">Sit this one out 🍹</p>
            <p className="mt-2 text-muted-foreground">
              You&apos;re on a break for round {state.nextRound.number}. Back after that.
            </p>
          </div>
          {pickPrompt}
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col">
        <PartnerCard
          partner={state.nextPartner}
          headline={`Next: round ${state.nextRound.number} — starts in ${mmss(state.nextRound.startsAt, nowMs)}`}
          sub="Reposition now so you can find each other."
        />
        {pickPrompt}
      </div>
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
        <div
          className="rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground"
          style={{ background: "linear-gradient(100deg, var(--candle), var(--flame))" }}
        >
          Round {state.round.number} of {state.totalRounds} ·{" "}
          <span className="tabular-nums">{mmss(state.round.endsAt, nowMs)}</span> left
        </div>
        <PartnerCard partner={state.partner} headline="Find each other" sub="This is your date for the round." />
        {state.partnerRegistrationId && (
          <ReportLink slug={slug} registrationId={state.partnerRegistrationId} />
        )}
      </div>
    );
  }

  // ended
  return (
    <div className="flex flex-1 flex-col">
      <div className="text-center">
        <p className="text-2xl font-semibold">That&apos;s a wrap 🎉</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Lock in your picks below — they close 15 minutes after the last round. Mutual
          matches land in your inbox tomorrow morning. Nobody ever sees a one-sided yes.
        </p>
      </div>
      {state.pastPartners && state.pastPartners.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {state.pastPartners.map((p) => (
            <li key={p.registrationId} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="size-12 shrink-0 overflow-hidden rounded-full border bg-muted">
                {p.photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photoUrl} alt="" className="size-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">Round {p.roundNumber}</p>
              </div>
              <PickButtons slug={slug} partner={p} onPicked={load} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

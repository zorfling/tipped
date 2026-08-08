"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SeatMeter } from "@/components/seat-meter";
import { cn } from "@/lib/utils";
import type { TallyResponse } from "@/app/api/events/[slug]/tally/route";

const POLL_MS = 10_000;

function useCountdown(target: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const ms = new Date(target).getTime() - Date.now();
      if (ms <= 0) {
        setLabel("deadline passed");
        return;
      }
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setLabel(d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  return label;
}

export function EventLive({ slug }: { slug: string }) {
  const [tally, setTally] = useState<TallyResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}/tally`, { cache: "no-store" });
      if (res.ok) setTally(await res.json());
    } catch {
      // transient network failure — next poll retries
    }
  }, [slug]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const countdown = useCountdown(tally?.tipDeadlineAt ?? null);

  if (!tally) {
    return <div className="mt-6 h-40 animate-pulse rounded-xl border bg-card" />;
  }

  const statusBanner: Record<string, string> = {
    tipped: "It's on! This night tipped — see you there.",
    locked: "It's on! This night tipped — see you there.",
    fizzled: "This one fizzled — not enough people by the deadline. Nobody was charged.",
    cancelled: "This night was cancelled. Nobody was charged.",
    live: "Happening right now.",
    matched: "This night has wrapped up.",
  };

  const bothTipped = tally.buckets.every((b) => b.activeCount >= b.minSize);

  return (
    <div className="mt-6">
      {tally.status === "open" && countdown && (
        <div
          className={cn(
            "mb-5 rounded-xl border px-4 py-3",
            bothTipped ? "border-candle/40 bg-accent/10" : "bg-card",
          )}
        >
          <p className="text-sm">
            <span className="font-heading text-lg font-bold tabular-nums text-candle">
              {countdown}
            </span>{" "}
            <span className="text-muted-foreground">
              {bothTipped ? "left — it's tipping. Stay in and it's on." : "to tip this night"}
            </span>
          </p>
        </div>
      )}
      {tally.status !== "open" && (
        <p className="mb-5 rounded-xl border border-candle/30 bg-accent/10 p-3 text-sm font-medium">
          {statusBanner[tally.status] ?? tally.status}
        </p>
      )}
      {["tipped", "locked", "live"].includes(tally.status) && (
        <Link
          href={`/e/${slug}/tonight`}
          className={cn(buttonVariants({ size: "lg" }), "mb-5 w-full")}
        >
          Open your night screen →
        </Link>
      )}

      <div className="flex flex-col gap-4">
        {tally.buckets.map((bucket) => {
          const needed = Math.max(bucket.minSize - bucket.activeCount, 0);
          return (
            <div key={bucket.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-heading text-lg font-semibold">{bucket.label}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  ${(bucket.priceCents / 100).toFixed(0)}
                </span>
              </div>
              <SeatMeter
                className="mt-3"
                active={bucket.activeCount}
                min={bucket.minSize}
                max={bucket.maxSize}
              />
              <p className="mt-2.5 text-sm text-muted-foreground">
                {needed > 0 ? (
                  <>
                    <span className="font-semibold text-foreground">{bucket.activeCount}</span> in ·{" "}
                    <span className="font-semibold text-candle">{needed} more</span> to tip
                    {bucket.waitlistCount > 0 && ` · ${bucket.waitlistCount} waitlisted`}
                  </>
                ) : (
                  <>
                    {bucket.activeCount} in — this side is ready
                    {bucket.waitlistCount > 0 && ` · ${bucket.waitlistCount} waitlisted`}
                  </>
                )}
              </p>
              {tally.status === "open" &&
                (bucket.cta === "sold_out" ? (
                  <span
                    className={cn(
                      buttonVariants({ variant: "secondary" }),
                      "mt-3 w-full opacity-50",
                    )}
                  >
                    Sold out
                  </span>
                ) : (
                  <Link
                    href={`/e/${slug}/join/${bucket.id}`}
                    className={cn(
                      buttonVariants({
                        variant: bucket.cta === "join" ? "default" : "secondary",
                      }),
                      "mt-3 w-full",
                    )}
                  >
                    {bucket.cta === "join"
                      ? `Join ${bucket.label}`
                      : "Join waitlist — this side is ahead"}
                  </Link>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

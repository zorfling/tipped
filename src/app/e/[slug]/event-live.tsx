"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
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
    return <div className="mt-6 h-40 animate-pulse rounded-lg border bg-muted/40" />;
  }

  const statusBanner: Record<string, string> = {
    tipped: "It's on! This event tipped — see you there.",
    locked: "It's on! This event tipped — see you there.",
    fizzled: "This one fizzled — not enough people by the deadline. Nobody was charged.",
    cancelled: "This event was cancelled. Nobody was charged.",
    live: "Happening right now.",
    matched: "This event has wrapped up.",
  };

  return (
    <div className="mt-6">
      {tally.status === "open" && countdown && (
        <p className="mb-4 text-sm">
          <span className="font-semibold">{countdown}</span>{" "}
          <span className="text-muted-foreground">until the tip deadline</span>
        </p>
      )}
      {tally.status !== "open" && (
        <p className="mb-4 rounded-md bg-muted p-3 text-sm font-medium">
          {statusBanner[tally.status] ?? tally.status}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {tally.buckets.map((bucket) => {
          const needed = Math.max(bucket.minSize - bucket.activeCount, 0);
          const pct = Math.min((bucket.activeCount / bucket.minSize) * 100, 100);
          return (
            <div key={bucket.id} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{bucket.label}</span>
                <span className="text-sm text-muted-foreground">
                  ${(bucket.priceCents / 100).toFixed(0)}
                </span>
              </div>
              <Progress className="mt-3" value={pct} />
              <p className="mt-2 text-sm text-muted-foreground">
                {needed > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{bucket.activeCount}</span> of{" "}
                    {bucket.minSize} needed
                    {bucket.waitlistCount > 0 && ` · ${bucket.waitlistCount} waitlisted`}
                  </>
                ) : (
                  <>
                    {bucket.activeCount} in — minimum met!
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
                      : `Join waitlist (the other side is ahead)`}
                  </Link>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

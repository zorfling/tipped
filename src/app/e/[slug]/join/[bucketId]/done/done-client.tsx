"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";

type Status =
  | { kind: "working" }
  | { kind: "done"; state: "reserved" | "waitlisted" }
  | { kind: "already" }
  | { kind: "error"; message: string };

export function DoneClient({ slug, bucketId }: { slug: string; bucketId: string }) {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>({ kind: "working" });
  const fired = useRef(false);

  const preState = params.get("state"); // dev mode already completed server-side
  const already = params.get("already");
  const setupIntentId = params.get("setup_intent");

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (already) {
      setStatus({ kind: "already" });
      return;
    }
    if (preState === "reserved" || preState === "waitlisted") {
      setStatus({ kind: "done", state: preState });
      return;
    }
    (async () => {
      const res = await fetch(`/api/events/${slug}/join/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId, setupIntentId: setupIntentId ?? undefined }),
      });
      const body = await res.json();
      if (res.ok) setStatus({ kind: "done", state: body.state });
      else if (res.status === 409) setStatus({ kind: "already" });
      else setStatus({ kind: "error", message: body.error ?? "Something went wrong" });
    })();
  }, [slug, bucketId, setupIntentId, preState, already]);

  if (status.kind === "working") {
    return <p className="text-sm text-muted-foreground">Finishing up…</p>;
  }
  if (status.kind === "error") {
    return (
      <div>
        <h1 className="text-xl font-semibold">Hmm, that didn&apos;t work</h1>
        <p className="mt-2 text-sm text-destructive">{status.message}</p>
        <Link href={`/e/${slug}`} className="mt-4 inline-block text-sm underline">
          Back to the event
        </Link>
      </div>
    );
  }

  const reserved = status.kind === "already" || status.state === "reserved";
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        {status.kind === "already"
          ? "You're already registered"
          : reserved
            ? "You're in — if it tips 🎉"
            : "You're on the waitlist"}
      </h1>
      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        {reserved ? (
          <>
            <p>
              <span className="font-medium text-foreground">You have not been charged.</span>{" "}
              Here&apos;s what happens next:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>If both sides fill by the deadline, the event tips.</li>
              <li>Only then is your card charged, and you&apos;ll get a receipt + calendar invite.</li>
              <li>If it doesn&apos;t tip, the night is off and you pay nothing.</li>
              <li>You can cancel free of charge any time before the deadline from your profile.</li>
            </ul>
          </>
        ) : (
          <>
            <p>
              Your side is ahead right now. Your card is saved but{" "}
              <span className="font-medium text-foreground">
                you&apos;ll only be charged if a spot opens and the event tips
              </span>
              .
            </p>
            <p>We&apos;ll email you the moment you&apos;re in. Best way to speed that up: bring a friend for the other side.</p>
          </>
        )}
      </div>
      <div className="mt-6 flex gap-3">
        <Link href={`/e/${slug}`} className={buttonVariants()}>
          Back to the event
        </Link>
        <Link href="/me" className={buttonVariants({ variant: "secondary" })}>
          Your events
        </Link>
      </div>
    </div>
  );
}

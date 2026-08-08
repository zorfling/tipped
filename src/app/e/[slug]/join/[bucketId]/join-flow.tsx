"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import type { TallyResponse } from "@/app/api/events/[slug]/tally/route";

interface Props {
  slug: string;
  bucketId: string;
  bucketLabel: string;
  priceCents: number;
  needsConduct: boolean;
}

export function JoinFlow(props: Props) {
  const router = useRouter();
  const [gate, setGate] = useState<"join" | "waitlist" | "sold_out" | null>(null);
  const [conductAccepted, setConductAccepted] = useState(!props.needsConduct);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stripeState, setStripeState] = useState<{
    stripe: Promise<Stripe | null>;
    clientSecret: string;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/events/${props.slug}/tally`, { cache: "no-store" })
      .then((r) => r.json())
      .then((t: TallyResponse) => {
        const bucket = t.buckets.find((b) => b.id === props.bucketId);
        setGate(bucket?.cta ?? null);
      })
      .catch(() => setGate(null));
  }, [props.slug, props.bucketId]);

  async function begin() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${props.slug}/join/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucketId: props.bucketId, acceptConduct: conductAccepted }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }
    if (body.mode === "dev") {
      // No Stripe keys configured — skip the card step entirely.
      setBusy(true);
      const done = await fetch(`/api/events/${props.slug}/join/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketId: props.bucketId }),
      });
      const doneBody = await done.json();
      setBusy(false);
      if (!done.ok) {
        setError(doneBody.error ?? "Something went wrong");
        return;
      }
      router.push(`/e/${props.slug}/join/${props.bucketId}/done?state=${doneBody.state}`);
      return;
    }
    setStripeState({
      stripe: loadStripe(body.publishableKey),
      clientSecret: body.clientSecret,
    });
  }

  if (stripeState) {
    return (
      <Elements
        stripe={stripeState.stripe}
        options={{ clientSecret: stripeState.clientSecret }}
      >
        <CardStep slug={props.slug} bucketId={props.bucketId} />
      </Elements>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {gate === "waitlist" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium">Heads up — you&apos;ll join the waitlist</p>
          <p className="mt-1">
            {props.bucketLabel} is ahead of the other side right now. Your card is saved,
            but you&apos;re only charged if a spot opens <em>and</em> the event goes ahead.
          </p>
        </div>
      )}
      {gate === "join" && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">You&apos;ll have a reserved spot</p>
          <p className="mt-1">
            You&apos;re only charged ${(props.priceCents / 100).toFixed(0)} if enough people
            join both sides by the deadline. If it doesn&apos;t tip, you pay nothing.
          </p>
        </div>
      )}
      {props.needsConduct && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={conductAccepted}
            onChange={(e) => setConductAccepted(e.target.checked)}
          />
          <span>
            I&apos;ll treat everyone with respect. Harassment of any kind means removal —
            there&apos;s a report button on every screen.
          </span>
        </label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={begin} disabled={busy || !conductAccepted || gate === "sold_out"}>
        {busy
          ? "One sec…"
          : gate === "sold_out"
            ? "Sold out"
            : "Save card — you'll only be charged if the event goes ahead"}
      </Button>
    </div>
  );
}

function CardStep({ slug, bucketId }: { slug: string; bucketId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: stripeError } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/e/${slug}/join/${bucketId}/done`,
      },
    });
    // Only reached on immediate failure — success redirects.
    setBusy(false);
    setError(stripeError?.message ?? null);
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || !stripe}>
        {busy ? "Saving…" : "Save card — you'll only be charged if the event goes ahead"}
      </Button>
    </form>
  );
}

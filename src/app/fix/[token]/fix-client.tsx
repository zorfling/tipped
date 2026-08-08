"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

export function FixClient({ token }: { token: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const setupIntentId = params.get("setup_intent");
  const [stripeState, setStripeState] = useState<{
    stripe: Promise<Stripe | null>;
    clientSecret: string;
  } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retried = useRef(false);

  // Returned from Stripe after saving the new card → retry the charge.
  useEffect(() => {
    if (!setupIntentId || retried.current) return;
    retried.current = true;
    (async () => {
      const res = await fetch(`/api/fix/${token}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Something went wrong");
      else setResult(body.status);
    })();
  }, [setupIntentId, token]);

  async function begin() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/fix/${token}/setup`, { method: "POST" });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }
    if (body.mode === "dev") {
      const retry = await fetch(`/api/fix/${token}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const retryBody = await retry.json();
      if (!retry.ok) setError(retryBody.error ?? "Something went wrong");
      else setResult(retryBody.status);
      return;
    }
    setStripeState({ stripe: loadStripe(body.publishableKey), clientSecret: body.clientSecret });
  }

  if (result === "succeeded") {
    return (
      <p className="mt-6 text-sm">
        ✅ Sorted — payment went through and your spot is confirmed. Receipt is on its way.
      </p>
    );
  }
  if (result) {
    return (
      <div className="mt-6 text-sm">
        <p className="text-destructive">
          That card didn&apos;t work either ({result.replace("_", " ")}).
        </p>
        <Button className="mt-3" onClick={() => router.replace(`/fix/${token}`)}>
          Try a different card
        </Button>
      </div>
    );
  }

  if (stripeState) {
    return (
      <Elements stripe={stripeState.stripe} options={{ clientSecret: stripeState.clientSecret }}>
        <CardStep token={token} />
      </Elements>
    );
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <Button onClick={begin} disabled={busy} className="w-full">
        {busy ? "One sec…" : setupIntentId ? "Retrying…" : "Save a working card & retry"}
      </Button>
    </div>
  );
}

function CardStep({ token }: { token: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const { error: stripeError } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/fix/${token}` },
    });
    setBusy(false);
    setError(stripeError?.message ?? null);
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || !stripe}>
        {busy ? "Saving…" : "Save card & retry payment"}
      </Button>
    </form>
  );
}

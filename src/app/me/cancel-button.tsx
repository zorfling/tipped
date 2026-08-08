"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelMyRegistration } from "./actions";

export function CancelButton({ registrationId }: { registrationId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Cancel spot
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await cancelMyRegistration(registrationId);
            if (res.error) setError(res.error);
          })
        }
      >
        {pending ? "Cancelling…" : "Yes, give up my spot"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </div>
  );
}

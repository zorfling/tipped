"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? undefined;
  const expired = params.get("error") === "expired";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, next }),
    });
    setState(res.ok ? "sent" : "error");
  }

  if (state === "sent") {
    return (
      <div className="rounded-lg border bg-muted/50 p-4 text-sm">
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-muted-foreground">
          We sent a sign-in link to <span className="font-medium">{email}</span>. It works
          for 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {expired && (
        <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          That link expired or was invalid — request a new one.
        </p>
      )}
      <Input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </Button>
      {state === "error" && (
        <p className="text-sm text-destructive">Something went wrong — try again.</p>
      )}
    </form>
  );
}

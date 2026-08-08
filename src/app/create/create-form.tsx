"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createEvent, type CreateEventState } from "./actions";

const initialState: CreateEventState = {};

function Field(props: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{props.label}</Label>
      {props.children}
      {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

export function CreateEventForm() {
  const [state, formAction, pending] = useActionState(createEvent, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Event name">
        <Input name="title" required minLength={3} placeholder="Tuesday night speed dating" />
      </Field>
      <Field label="City">
        <Input name="city" required placeholder="Brisbane" />
      </Field>
      <Field label="Venue">
        <Input name="venueName" required placeholder="The Gresham" />
      </Field>
      <Field label="Venue address">
        <Input name="venueAddress" required placeholder="308 Queen St, Brisbane City" />
      </Field>
      <Field label="Venue notes (optional)" hint="How to find the group on the night.">
        <Textarea name="venueNotes" placeholder="Back bar — look for the neon flamingo" />
      </Field>
      <Field
        label="Starts at"
        hint="Signups close 48 hours before this. If both sides fill by then, everyone is charged and it's on; otherwise it fizzles and nobody pays."
      >
        <Input name="startsAt" type="datetime-local" required />
      </Field>
      <Field label="Ticket price (AUD)" hint="Minimum $10 — a real ticket is what stops flaking.">
        <PriceInput />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Side A label">
          <Input name="bucketALabel" required defaultValue="Side A" />
        </Field>
        <Field label="Side B label">
          <Input name="bucketBLabel" required defaultValue="Side B" />
        </Field>
      </div>
      <Field label="Which side are you joining?">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="myBucket" value="a" defaultChecked required /> Side A
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="myBucket" value="b" /> Side B
          </label>
        </div>
      </Field>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create event & join it"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Each side needs 6–12 people, roughly balanced, or the night doesn&apos;t happen. Nobody
        is charged unless it does.
      </p>
    </form>
  );
}

function PriceInput() {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
        $
      </span>
      <Input
        className="pl-7"
        name="priceDollars"
        type="number"
        min={10}
        step={1}
        defaultValue={25}
        required
        onChange={() => {}}
      />
      <PriceCentsBridge />
    </div>
  );
}

/** The action expects priceCents; mirror the dollars input into a hidden field. */
function PriceCentsBridge() {
  return (
    <input
      type="hidden"
      name="priceCents"
      ref={(el) => {
        if (!el) return;
        const form = el.form;
        const dollars = form?.elements.namedItem("priceDollars") as HTMLInputElement | null;
        if (!form || !dollars) return;
        const sync = () => {
          el.value = String(Math.round(Number(dollars.value || "0") * 100));
        };
        sync();
        dollars.addEventListener("input", sync);
      }}
    />
  );
}

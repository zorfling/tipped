"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelWholeEvent, editEvent, extendDeadline } from "./actions";

interface Props {
  slug: string;
  initial: { title: string; venueName: string; venueAddress: string; venueNotes: string };
  deadline: string;
  alreadyExtended: boolean;
}

export function ManageForms({ slug, initial, deadline, alreadyExtended }: Props) {
  const [editState, editAction, editPending] = useActionState(
    editEvent.bind(null, slug),
    {} as { error?: string; saved?: boolean },
  );
  const [extendError, setExtendError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6 flex flex-col gap-8">
      <form action={editAction} className="flex flex-col gap-3">
        <Label>Title</Label>
        <Input name="title" defaultValue={initial.title} required />
        <Label>Venue</Label>
        <Input name="venueName" defaultValue={initial.venueName} required />
        <Label>Address</Label>
        <Input name="venueAddress" defaultValue={initial.venueAddress} required />
        <Label>Venue notes</Label>
        <Textarea name="venueNotes" defaultValue={initial.venueNotes} />
        {editState.error && <p className="text-sm text-destructive">{editState.error}</p>}
        {editState.saved && <p className="text-sm text-green-600">Saved.</p>}
        <Button type="submit" disabled={editPending}>
          {editPending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">Tip deadline</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date(deadline).toLocaleString()} —{" "}
          {alreadyExtended ? "already extended once (that's the limit)." : "you can push it back 24h, once."}
        </p>
        {!alreadyExtended && (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await extendDeadline(slug);
                setExtendError(res.error ?? null);
                if (!res.error) window.location.reload();
              })
            }
          >
            Extend deadline by 24h
          </Button>
        )}
        {extendError && <p className="mt-2 text-sm text-destructive">{extendError}</p>}
      </div>

      <div className="rounded-lg border border-destructive/40 p-4">
        <p className="text-sm font-medium">Cancel this event</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone is released and emailed. Nobody has been charged — charges only ever
          happen after tipping.
        </p>
        {!confirmingCancel ? (
          <Button
            variant="destructive"
            className="mt-3"
            onClick={() => setConfirmingCancel(true)}
          >
            Cancel event…
          </Button>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await cancelWholeEvent(slug);
                  if (res?.error) setCancelError(res.error);
                })
              }
            >
              {pending ? "Cancelling…" : "Yes — cancel it for everyone"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
              Keep it
            </Button>
          </div>
        )}
        {cancelError && <p className="mt-2 text-sm text-destructive">{cancelError}</p>}
      </div>
    </div>
  );
}

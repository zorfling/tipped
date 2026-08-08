import { db, buckets, events, registrations } from "@/db";
import { DEFAULTS, MIN_PRICE_CENTS } from "@/lib/constants";
import { shortId } from "@/lib/slug";

export interface CreateEventInput {
  title: string;
  city: string;
  venueName: string;
  venueAddress: string;
  venueNotes?: string;
  startsAt: Date;
  priceCents: number;
  bucketALabel: string;
  bucketBLabel: string;
  myBucket: "a" | "b";
}

export type CreateEventResult = { ok: true; slug: string } | { ok: false; error: string };

/** Create an event from the speed-dating template and register the creator as attendee #1. */
export async function createEventForUser(
  userId: string,
  input: CreateEventInput,
): Promise<CreateEventResult> {
  if (input.priceCents < MIN_PRICE_CENTS) {
    return { ok: false, error: "Ticket price is below the minimum" };
  }
  if (input.startsAt.getTime() < Date.now() + 60 * 60 * 1000) {
    return { ok: false, error: "Events must start at least an hour from now" };
  }
  const tipDeadlineAt = new Date(
    input.startsAt.getTime() - DEFAULTS.tipDeadlineHoursBefore * 3600 * 1000,
  );
  if (tipDeadlineAt.getTime() < Date.now()) {
    return {
      ok: false,
      error: "Too soon — the tip deadline is 48h before start, and it has to be in the future",
    };
  }
  if (input.bucketALabel.trim().toLowerCase() === input.bucketBLabel.trim().toLowerCase()) {
    return { ok: false, error: "The two sides need different labels" };
  }

  const slug = shortId();
  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({
        creatorId: userId,
        slug,
        title: input.title,
        city: input.city,
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        venueNotes: input.venueNotes || null,
        startsAt: input.startsAt,
        tipDeadlineAt,
        status: "open",
      })
      .returning();

    const [bucketA, bucketB] = await tx
      .insert(buckets)
      .values([
        {
          eventId: event.id,
          label: input.bucketALabel.trim(),
          priceCents: input.priceCents,
          sortOrder: 0,
          minSize: DEFAULTS.minSize,
          maxSize: DEFAULTS.maxSize,
        },
        {
          eventId: event.id,
          label: input.bucketBLabel.trim(),
          priceCents: input.priceCents,
          sortOrder: 1,
          minSize: DEFAULTS.minSize,
          maxSize: DEFAULTS.maxSize,
        },
      ])
      .returning();

    // The creator is attendee #1 — no special powers, just first in.
    await tx.insert(registrations).values({
      eventId: event.id,
      bucketId: input.myBucket === "a" ? bucketA.id : bucketB.id,
      userId,
      state: "reserved",
      manageToken: shortId(24),
    });
  });

  return { ok: true, slug };
}

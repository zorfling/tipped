"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, events } from "@/db";
import { getSessionUserId } from "@/lib/auth";
import { sendEventCancelledEmail } from "@/lib/notifications";
import { cancelEvent } from "@/lib/tipper";

async function loadOwnedOpenEvent(slug: string) {
  const userId = await getSessionUserId();
  if (!userId) return { error: "Not signed in" as const };
  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  if (!event || event.creatorId !== userId) return { error: "Not your event" as const };
  if (event.status !== "open") return { error: "This event has already tipped — no more edits" as const };
  return { event, userId };
}

const editSchema = z.object({
  title: z.string().trim().min(3).max(120),
  venueName: z.string().trim().min(1).max(120),
  venueAddress: z.string().trim().min(1).max(200),
  venueNotes: z.string().trim().max(500).optional(),
});

export async function editEvent(
  slug: string,
  _prev: { error?: string; saved?: boolean },
  formData: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const loaded = await loadOwnedOpenEvent(slug);
  if ("error" in loaded) return { error: loaded.error };
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the form and try again" };
  await db
    .update(events)
    .set({ ...parsed.data, venueNotes: parsed.data.venueNotes || null })
    .where(eq(events.id, loaded.event.id));
  revalidatePath(`/e/${slug}`);
  return { saved: true };
}

/** The creator may push the deadline back 24h exactly once. */
export async function extendDeadline(slug: string): Promise<{ error?: string }> {
  const loaded = await loadOwnedOpenEvent(slug);
  if ("error" in loaded) return { error: loaded.error };
  const { event } = loaded;
  if (event.deadlineExtendedAt) return { error: "You've already extended once — that's the limit" };
  const newDeadline = new Date(event.tipDeadlineAt.getTime() + 24 * 3600 * 1000);
  if (newDeadline.getTime() >= event.startsAt.getTime()) {
    return { error: "Can't extend past the event start" };
  }
  await db
    .update(events)
    .set({ tipDeadlineAt: newDeadline, deadlineExtendedAt: new Date() })
    .where(eq(events.id, event.id));
  revalidatePath(`/e/${slug}`);
  return {};
}

export async function cancelWholeEvent(slug: string): Promise<{ error?: string }> {
  const loaded = await loadOwnedOpenEvent(slug);
  if ("error" in loaded) return { error: loaded.error };
  const result = await cancelEvent({ eventId: loaded.event.id, byUserId: loaded.userId });
  if (!result.ok) return { error: result.error };
  for (const reg of result.released) {
    await sendEventCancelledEmail(result.event, reg);
  }
  redirect(`/e/${slug}`);
}

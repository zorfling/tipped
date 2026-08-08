"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { MIN_PRICE_CENTS } from "@/lib/constants";
import { createEventForUser } from "@/lib/createEvent";

const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  city: z.string().trim().min(1).max(80),
  venueName: z.string().trim().min(1).max(120),
  venueAddress: z.string().trim().min(1).max(200),
  venueNotes: z.string().trim().max(500).optional(),
  startsAt: z.coerce.date(),
  priceCents: z.coerce.number().int().min(MIN_PRICE_CENTS, "Minimum ticket price is $10"),
  bucketALabel: z.string().trim().min(1).max(60),
  bucketBLabel: z.string().trim().min(1).max(60),
  myBucket: z.enum(["a", "b"]),
});

export interface CreateEventState {
  error?: string;
}

export async function createEvent(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/create");
  if (!user.name || !user.photoUrl) redirect("/create"); // page shows the profile step

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  }

  const result = await createEventForUser(user.id, parsed.data);
  if (!result.ok) return { error: result.error };
  redirect(`/e/${result.slug}`);
}

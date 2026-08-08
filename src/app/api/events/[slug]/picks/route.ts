import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, registrations } from "@/db";
import { getSessionUserId } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { submitPick } from "@/lib/matching";

const bodySchema = z.object({
  toRegistrationId: z.string().uuid(),
  choice: z.enum(["yes", "no"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const [myReg] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.userId, userId)));
  if (!myReg) return NextResponse.json({ error: "Not registered" }, { status: 403 });

  const result = await submitPick({
    eventId: event.id,
    fromRegistrationId: myReg.id,
    toRegistrationId: parsed.data.toRegistrationId,
    choice: parsed.data.choice,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

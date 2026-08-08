import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, blocks, registrations } from "@/db";
import { getSessionUserId } from "@/lib/auth";

const bodySchema = z.object({
  blockedRegistrationId: z.string().uuid(),
});

/** Block the person behind a registration you've encountered. Idempotent. */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const [reg] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, parsed.data.blockedRegistrationId));
  if (!reg) return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  if (reg.userId === userId) return NextResponse.json({ error: "That's you" }, { status: 400 });

  await db
    .insert(blocks)
    .values({ blockerUserId: userId, blockedUserId: reg.userId })
    .onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const [reg] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, parsed.data.blockedRegistrationId));
  if (!reg) return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  await db
    .delete(blocks)
    .where(and(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, reg.userId)));
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { getSessionUserId } from "@/lib/auth";
import { savePhoto } from "@/lib/storage";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData();
  const name = form.get("name");
  const photo = form.get("photo");

  const update: { name?: string; photoUrl?: string } = {};
  if (typeof name === "string" && name.trim()) update.name = name.trim().slice(0, 80);

  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Photo too large" }, { status: 400 });
    }
    const buffer = Buffer.from(await photo.arrayBuffer());
    update.photoUrl = await savePhoto(userId, buffer);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [user] = await db.update(users).set(update).where(eq(users.id, userId)).returning();
  return NextResponse.json({ ok: true, name: user.name, photoUrl: user.photoUrl });
}

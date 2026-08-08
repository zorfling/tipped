import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { getNightState } from "@/lib/nightState";
import { CHECKIN_GRACE_AFTER_MS, generateScheduleForEvent } from "@/lib/schedule";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Lazy self-healing: the first poll past starts_at + grace triggers schedule
  // generation, so nobody waits on cron cadence. Idempotent under the event lock.
  const now = new Date();
  if (
    event.status === "tipped" &&
    now.getTime() >= event.startsAt.getTime() + CHECKIN_GRACE_AFTER_MS
  ) {
    await generateScheduleForEvent(event.id, now);
    const refreshed = await getEventBySlug(slug);
    if (refreshed) Object.assign(event, refreshed);
  }

  const state = await getNightState(event, userId, now);
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

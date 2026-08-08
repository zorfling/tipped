import { and, asc, eq, gt, ilike, inArray, sql } from "drizzle-orm";
import { db, buckets, events, registrations, type Bucket, type Event } from "@/db";
import { ACTIVE_STATES } from "@/lib/constants";

export interface BucketTally extends Bucket {
  activeCount: number;
  waitlistCount: number;
}

export async function getOpenEvents(city?: string): Promise<Event[]> {
  const conditions = [eq(events.status, "open" as const), gt(events.startsAt, new Date())];
  if (city?.trim()) conditions.push(ilike(events.city, `%${city.trim()}%`));
  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.startsAt));
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  return event ?? null;
}

export async function getBucketTallies(eventId: string): Promise<BucketTally[]> {
  const rows = await db
    .select({
      bucket: buckets,
      activeCount: sql<number>`count(*) filter (where ${inArray(
        registrations.state,
        [...ACTIVE_STATES],
      )})`.mapWith(Number),
      waitlistCount: sql<number>`count(*) filter (where ${eq(
        registrations.state,
        "waitlisted",
      )})`.mapWith(Number),
    })
    .from(buckets)
    .leftJoin(registrations, eq(registrations.bucketId, buckets.id))
    .where(eq(buckets.eventId, eventId))
    .groupBy(buckets.id)
    .orderBy(asc(buckets.sortOrder));
  return rows.map((r) => ({ ...r.bucket, activeCount: r.activeCount, waitlistCount: r.waitlistCount }));
}

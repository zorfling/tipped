import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  buckets,
  emailLog,
  events,
  registrations,
  users,
  type Event,
} from "@/db";
import { shortId } from "@/lib/slug";
import { joinEvent, cancelRegistration } from "@/lib/registration";
import { sendPromotedEmail } from "@/lib/notifications";

const hasDb = Boolean(process.env.DATABASE_URL);

const createdEventIds: string[] = [];
const createdUserIds: string[] = [];

async function seedUser(tag: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email: `it-${tag}-${shortId(6)}@test.tipped.local`,
      name: tag,
      photoUrl: "/api/photos/test",
    })
    .returning();
  createdUserIds.push(user.id);
  return user.id;
}

async function seedEvent(): Promise<{ event: Event; bucketA: string; bucketB: string }> {
  const creator = await seedUser("creator");
  const [event] = await db
    .insert(events)
    .values({
      creatorId: creator,
      slug: `it-${shortId(6)}`,
      title: "Integration test event",
      city: "Testville",
      venueName: "Test Bar",
      venueAddress: "1 Test St",
      startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      tipDeadlineAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      status: "open",
    })
    .returning();
  createdEventIds.push(event.id);
  const [a, b] = await db
    .insert(buckets)
    .values([
      { eventId: event.id, label: "Side A", priceCents: 2500, sortOrder: 0 },
      { eventId: event.id, label: "Side B", priceCents: 2500, sortOrder: 1 },
    ])
    .returning();
  return { event, bucketA: a.id, bucketB: b.id };
}

async function join(eventId: string, bucketId: string, tag: string) {
  const userId = await seedUser(tag);
  const result = await joinEvent({ userId, eventId, bucketId });
  if (!result.ok) throw new Error(`join failed: ${result.error}`);
  return { userId, result };
}

afterAll(async () => {
  if (!hasDb) return;
  if (createdEventIds.length) {
    await db.delete(emailLog).where(inArray(emailLog.eventId, createdEventIds));
    await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
    await db.delete(buckets).where(inArray(buckets.eventId, createdEventIds));
    await db.delete(events).where(inArray(events.id, createdEventIds));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe.skipIf(!hasDb)("registration gating (Neon integration)", () => {
  it("waitlists a same-side signup when imbalance is at the limit, and an opposite-side signup both reserves and promotes", async () => {
    const { event, bucketA, bucketB } = await seedEvent();
    // A: 2, B: 0 → imbalance at limit (2)
    await join(event.id, bucketA, "a1");
    await join(event.id, bucketA, "a2");

    // Next same-side signup must waitlist
    const { result: a3 } = await join(event.id, bucketA, "a3");
    expect(a3.state).toBe("waitlisted");
    expect(a3.registration.waitlistedAt).not.toBeNull();

    // Opposite-side signup reserves AND unlocks the waitlisted A
    const { result: b1 } = await join(event.id, bucketB, "b1");
    expect(b1.state).toBe("reserved");
    expect(b1.promoted.map((r) => r.id)).toEqual([a3.registration.id]);

    const [a3Row] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, a3.registration.id));
    expect(a3Row.state).toBe("reserved");
  });

  it("cancellation promotes the oldest eligible waitlisted person; promotion email is idempotent", async () => {
    const { event, bucketA } = await seedEvent();
    // A: 2 reserved (imbalance at limit vs empty B), then two A hopefuls waitlist
    await join(event.id, bucketA, "a1");
    const { result: a2 } = await join(event.id, bucketA, "a2");
    const { result: w1 } = await join(event.id, bucketA, "w1");
    const { result: w2 } = await join(event.id, bucketA, "w2");
    expect(w1.state).toBe("waitlisted");
    expect(w2.state).toBe("waitlisted");

    // Cancelling a reserved A frees a same-side slot → exactly the OLDEST
    // waitlisted entry (w1) is promoted, not the younger w2
    const cancelled = await cancelRegistration({
      userId: a2.registration.userId,
      registrationId: a2.registration.id,
    });
    if (!cancelled.ok) throw new Error(cancelled.error);
    expect(cancelled.promoted.map((r) => r.id)).toEqual([w1.registration.id]);

    const [w1Row] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, w1.registration.id));
    expect(w1Row.state).toBe("reserved");

    // Promotion email sends exactly once across two calls
    await sendPromotedEmail(cancelled.event, cancelled.promoted[0]);
    await sendPromotedEmail(cancelled.event, cancelled.promoted[0]);
    const logs = await db
      .select()
      .from(emailLog)
      .where(eq(emailLog.registrationId, w1.registration.id));
    expect(logs.filter((l) => l.type === "promoted")).toHaveLength(1);
  });

  it("two concurrent signups for the last balanced slot: exactly one reserved, one waitlisted", async () => {
    const { event, bucketA } = await seedEvent();
    // A: 1, B: 0 → one more A fits (imbalance would be 2), the next must waitlist
    await join(event.id, bucketA, "a1");

    const u1 = await seedUser("race1");
    const u2 = await seedUser("race2");
    const [r1, r2] = await Promise.all([
      joinEvent({ userId: u1, eventId: event.id, bucketId: bucketA }),
      joinEvent({ userId: u2, eventId: event.id, bucketId: bucketA }),
    ]);
    if (!r1.ok || !r2.ok) throw new Error("concurrent join failed");
    const states = [r1.state, r2.state].sort();
    expect(states).toEqual(["reserved", "waitlisted"]);
  });

  it("rejects double registration and closed events", async () => {
    const { event, bucketA } = await seedEvent();
    const { userId } = await join(event.id, bucketA, "dup");
    const again = await joinEvent({ userId, eventId: event.id, bucketId: bucketA });
    expect(again.ok).toBe(false);

    await db.update(events).set({ status: "tipped" }).where(eq(events.id, event.id));
    const late = await joinEvent({
      userId: await seedUser("late"),
      eventId: event.id,
      bucketId: bucketA,
    });
    expect(late.ok).toBe(false);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  assignments,
  blocks,
  buckets,
  emailLog,
  events,
  registrations,
  rounds,
  users,
  type Event,
  type Registration,
} from "@/db";
import { shortId } from "@/lib/slug";
import { checkIn, generateScheduleForEvent } from "@/lib/schedule";
import { getNightState } from "@/lib/nightState";

const hasDb = Boolean(process.env.DATABASE_URL);
const createdEventIds: string[] = [];
const createdUserIds: string[] = [];

interface Night {
  event: Event;
  sideA: Registration[];
  sideB: Registration[];
  extraConfirmed: Registration[];
}

/** Event that started 10 min ago (check-in grace just elapsed), everyone checked in. */
async function seedNight(opts: {
  sideA: number;
  sideB: number;
  extraConfirmedB?: number;
}): Promise<Night> {
  const [creator] = await db
    .insert(users)
    .values({ email: `night-creator-${shortId(6)}@test.tipped.local` })
    .returning();
  createdUserIds.push(creator.id);
  const startsAt = new Date(Date.now() - 10 * 60 * 1000);
  const [event] = await db
    .insert(events)
    .values({
      creatorId: creator.id,
      slug: `night-${shortId(6)}`,
      title: "Night test",
      city: "Testville",
      venueName: "Test Bar",
      venueAddress: "1 Test St",
      startsAt,
      tipDeadlineAt: new Date(startsAt.getTime() - 48 * 3600 * 1000),
      status: "tipped",
      roundLengthSec: 300,
      breakLengthSec: 90,
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

  async function seedRegs(bucketId: string, count: number, prefix: string, state: "checked_in" | "confirmed") {
    const regs: Registration[] = [];
    for (let i = 0; i < count; i++) {
      const [user] = await db
        .insert(users)
        .values({
          email: `night-${prefix}${i}-${shortId(6)}@test.tipped.local`,
          name: `${prefix.toUpperCase()}${i}`,
          photoUrl: `/api/photos/${prefix}${i}`,
        })
        .returning();
      createdUserIds.push(user.id);
      const [reg] = await db
        .insert(registrations)
        .values({
          eventId: event.id,
          bucketId,
          userId: user.id,
          state,
          manageToken: shortId(24),
          checkedInAt: state === "checked_in" ? new Date(startsAt.getTime() - 5 * 60 * 1000) : null,
        })
        .returning();
      regs.push(reg);
    }
    return regs;
  }

  const sideA = await seedRegs(a.id, opts.sideA, "a", "checked_in");
  const sideB = await seedRegs(b.id, opts.sideB, "b", "checked_in");
  const extraConfirmed = await seedRegs(b.id, opts.extraConfirmedB ?? 0, "late", "confirmed");
  return { event, sideA, sideB, extraConfirmed };
}

async function pairSet(eventId: string): Promise<Map<string, number>> {
  const eventRounds = await db.select().from(rounds).where(eq(rounds.eventId, eventId));
  const rows = await db
    .select()
    .from(assignments)
    .where(inArray(assignments.roundId, eventRounds.map((r) => r.id)));
  const pairs = new Map<string, number>();
  for (const row of rows) {
    if (row.registrationBId === null) continue;
    const key = `${row.registrationAId}|${row.registrationBId}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return pairs;
}

afterAll(async () => {
  if (!hasDb) return;
  if (createdEventIds.length) {
    const eventRounds = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(inArray(rounds.eventId, createdEventIds));
    if (eventRounds.length) {
      await db.delete(assignments).where(inArray(assignments.roundId, eventRounds.map((r) => r.id)));
    }
    await db.delete(rounds).where(inArray(rounds.eventId, createdEventIds));
    await db.delete(emailLog).where(inArray(emailLog.eventId, createdEventIds));
    await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
    await db.delete(buckets).where(inArray(buckets.eventId, createdEventIds));
    await db.delete(events).where(inArray(events.id, createdEventIds));
  }
  if (createdUserIds.length) {
    await db.delete(blocks).where(inArray(blocks.blockerUserId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe.skipIf(!hasDb)("autonomous night (Neon integration, injected clock)", () => {
  it("8v8: generates 8 rounds, all 64 pairs meet exactly once, state endpoint tracks the clock", async () => {
    const { event, sideA, sideB } = await seedNight({ sideA: 8, sideB: 8 });
    const now = new Date();

    expect(await generateScheduleForEvent(event.id, now)).toBe("scheduled");
    expect(await generateScheduleForEvent(event.id, now)).toBe("skipped"); // idempotent

    const [live] = await db.select().from(events).where(eq(events.id, event.id));
    expect(live.status).toBe("live");

    const eventRounds = await db
      .select()
      .from(rounds)
      .where(eq(rounds.eventId, event.id))
      .orderBy(asc(rounds.number));
    expect(eventRounds).toHaveLength(8);

    const pairs = await pairSet(event.id);
    expect(pairs.size).toBe(64);
    expect([...pairs.values()].every((n) => n === 1)).toBe(true);

    // Injected-clock probes of the derived state
    const r1 = eventRounds[0];
    const midRound1 = new Date(r1.scheduledStartAt.getTime() + 60_000);
    const stateA0 = await getNightState(live, sideA[0].userId, midRound1);
    expect(stateA0.phase).toBe("round");
    expect(stateA0.round?.number).toBe(1);
    expect(stateA0.partner).not.toBeNull();

    // Mirrored card: A0's round-1 partner sees A0
    const partnerReg = sideB.find((r) => r.id === stateA0.partnerRegistrationId)!;
    const statePartner = await getNightState(live, partnerReg.userId, midRound1);
    expect(statePartner.phase).toBe("round");
    expect(statePartner.partnerRegistrationId).toBe(sideA[0].id);

    const inBreak = new Date(r1.scheduledEndAt.getTime() + 10_000);
    const stateBreak = await getNightState(live, sideA[0].userId, inBreak);
    expect(stateBreak.phase).toBe("break");
    expect(stateBreak.nextRound?.number).toBe(2);
    expect(stateBreak.nextPartner).not.toBeNull();

    const afterEnd = new Date(eventRounds[7].scheduledEndAt.getTime() + 1000);
    const stateEnd = await getNightState(live, sideA[0].userId, afterEnd);
    expect(stateEnd.phase).toBe("ended");
  }, 120_000);

  it("8v6: byes spread evenly; a late check-in during round 1 fills bye seats from round 2", async () => {
    const { event, sideA, extraConfirmed } = await seedNight({
      sideA: 8,
      sideB: 6,
      extraConfirmedB: 1,
    });
    const now = new Date();
    expect(await generateScheduleForEvent(event.id, now)).toBe("scheduled");

    // Bye evenness: every A meets all 6 Bs → 2 byes each across 8 rounds
    const pairs = await pairSet(event.id);
    const meetCount = new Map<string, number>();
    for (const key of pairs.keys()) {
      const [aId, bId] = key.split("|");
      meetCount.set(aId, (meetCount.get(aId) ?? 0) + 1);
      meetCount.set(bId, (meetCount.get(bId) ?? 0) + 1);
    }
    for (const a of sideA) expect(meetCount.get(a.id)).toBe(6);

    // Late arrival mid-round-1
    const eventRounds = await db
      .select()
      .from(rounds)
      .where(eq(rounds.eventId, event.id))
      .orderBy(asc(rounds.number));
    const midRound1 = new Date(eventRounds[0].scheduledStartAt.getTime() + 60_000);
    const late = extraConfirmed[0];
    const result = await checkIn({ userId: late.userId, eventId: event.id, now: midRound1 });
    expect(result).toEqual({ ok: true, late: true });

    const pairsAfter = await pairSet(event.id);
    // Late B never appears in round 1
    const r1Assignments = await db
      .select()
      .from(assignments)
      .where(eq(assignments.roundId, eventRounds[0].id));
    expect(
      r1Assignments.some(
        (a) => a.registrationAId === late.id || a.registrationBId === late.id,
      ),
    ).toBe(false);
    // From round 2 on, late B fills bye seats with distinct, never-duplicated partners
    const latePairs = [...pairsAfter.keys()].filter((k) => k.includes(late.id));
    expect(latePairs.length).toBe(7); // one unmet A per remaining round
    expect([...pairsAfter.values()].every((n) => n === 1)).toBe(true);

    // And no more duplicate meetings anywhere
    const allCounts = new Map<string, number>();
    for (const key of pairsAfter.keys()) {
      for (const id of key.split("|")) allCounts.set(id, (allCounts.get(id) ?? 0) + 1);
    }
    for (const a of sideA) expect(allCounts.get(a.id)!).toBeLessThanOrEqual(7);
  }, 120_000);

  it("a blocked pair is never assigned; everyone else still meets exactly once", async () => {
    const { event, sideA, sideB } = await seedNight({ sideA: 4, sideB: 4 });
    await db.insert(blocks).values({
      blockerUserId: sideA[2].userId,
      blockedUserId: sideB[1].userId,
    });

    expect(await generateScheduleForEvent(event.id, new Date())).toBe("scheduled");
    const pairs = await pairSet(event.id);
    expect(pairs.has(`${sideA[2].id}|${sideB[1].id}`)).toBe(false);
    expect(pairs.size).toBe(15); // 16 possible minus the blocked one
    expect([...pairs.values()].every((n) => n === 1)).toBe(true);
  }, 120_000);

  it("auto-cancels night-of when a side has fewer than 3 checked in; apology emails go out", async () => {
    const { event } = await seedNight({ sideA: 2, sideB: 6 });
    expect(await generateScheduleForEvent(event.id, new Date())).toBe("cancelled_night_of");

    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row.status).toBe("cancelled");

    const emails = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.eventId, event.id), eq(emailLog.type, "night_cancelled")));
    expect(emails).toHaveLength(8);
  }, 120_000);
});

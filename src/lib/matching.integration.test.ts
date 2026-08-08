import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  assignments,
  buckets,
  emailLog,
  events,
  matches,
  picks,
  registrations,
  rounds,
  users,
  type Event,
  type Registration,
} from "@/db";
import { shortId } from "@/lib/slug";
import { closeEvent, purgeOldPicks, revealDueMatches, submitPick } from "@/lib/matching";

const hasDb = Boolean(process.env.DATABASE_URL);
const createdEventIds: string[] = [];
const createdUserIds: string[] = [];

/**
 * A finished 2v2 night: two rounds, everyone met everyone, final round ended
 * 20+ minutes ago. Returns regs [a0, a1, b0, b1].
 */
async function seedFinishedNight(opts?: { daysAgo?: number }): Promise<{
  event: Event;
  regs: Registration[];
}> {
  const daysAgo = opts?.daysAgo ?? 2;
  const startsAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
  const [creator] = await db
    .insert(users)
    .values({ email: `match-creator-${shortId(6)}@test.tipped.local` })
    .returning();
  createdUserIds.push(creator.id);
  const [event] = await db
    .insert(events)
    .values({
      creatorId: creator.id,
      slug: `match-${shortId(6)}`,
      title: "Match test",
      city: "Testville",
      venueName: "Test Bar",
      venueAddress: "1 Test St",
      startsAt,
      tipDeadlineAt: new Date(startsAt.getTime() - 48 * 3600 * 1000),
      status: "live",
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

  const regs: Registration[] = [];
  for (const [bucketId, prefix] of [
    [a.id, "a"],
    [b.id, "b"],
  ] as const) {
    for (let i = 0; i < 2; i++) {
      const [user] = await db
        .insert(users)
        .values({
          email: `match-${prefix}${i}-${shortId(6)}@test.tipped.local`,
          name: `${prefix.toUpperCase()}${i}`,
          photoUrl: `/api/photos/x`,
        })
        .returning();
      createdUserIds.push(user.id);
      const [reg] = await db
        .insert(registrations)
        .values({
          eventId: event.id,
          bucketId,
          userId: user.id,
          state: "checked_in",
          manageToken: shortId(24),
          checkedInAt: startsAt,
        })
        .returning();
      regs.push(reg);
    }
  }
  const [a0, a1, b0, b1] = regs;

  const roundDefs = [
    { number: 1, pairs: [[a0, b0], [a1, b1]] },
    { number: 2, pairs: [[a0, b1], [a1, b0]] },
  ];
  for (const def of roundDefs) {
    const start = new Date(startsAt.getTime() + (def.number - 1) * 390_000);
    const [round] = await db
      .insert(rounds)
      .values({
        eventId: event.id,
        number: def.number,
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + 300_000),
      })
      .returning();
    await db.insert(assignments).values(
      def.pairs.map(([ra, rb]) => ({
        roundId: round.id,
        registrationAId: ra.id,
        registrationBId: rb.id,
      })),
    );
  }
  return { event, regs };
}

afterAll(async () => {
  if (!hasDb) return;
  if (createdEventIds.length) {
    const eventRounds = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(inArray(rounds.eventId, createdEventIds));
    if (eventRounds.length) {
      await db
        .delete(assignments)
        .where(inArray(assignments.roundId, eventRounds.map((r) => r.id)));
    }
    await db.delete(picks).where(inArray(picks.eventId, createdEventIds));
    await db.delete(matches).where(inArray(matches.eventId, createdEventIds));
    await db.delete(rounds).where(inArray(rounds.eventId, createdEventIds));
    await db.delete(emailLog).where(inArray(emailLog.eventId, createdEventIds));
    await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
    await db.delete(buckets).where(inArray(buckets.eventId, createdEventIds));
    await db.delete(events).where(inArray(events.id, createdEventIds));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe.skipIf(!hasDb)("matching + privacy (Neon integration)", () => {
  it("mutual yes → match + reveal email to both; one-sided yes → nothing, ever", async () => {
    const { event, regs } = await seedFinishedNight();
    const [a0, a1, b0, b1] = regs;

    // Picks: a0↔b0 mutual yes; a1→b1 yes but b1→a1 no; b0→a1 yes unreciprocated
    const p1 = await submitPick({ eventId: event.id, fromRegistrationId: a0.id, toRegistrationId: b0.id, choice: "yes" });
    expect(p1.ok).toBe(true);
    await submitPick({ eventId: event.id, fromRegistrationId: b0.id, toRegistrationId: a0.id, choice: "yes" });
    await submitPick({ eventId: event.id, fromRegistrationId: a1.id, toRegistrationId: b1.id, choice: "yes" });
    await submitPick({ eventId: event.id, fromRegistrationId: b1.id, toRegistrationId: a1.id, choice: "no" });
    await submitPick({ eventId: event.id, fromRegistrationId: b0.id, toRegistrationId: a1.id, choice: "yes" });

    // Picks only valid between people actually paired
    const invalid = await submitPick({ eventId: event.id, fromRegistrationId: a0.id, toRegistrationId: a1.id, choice: "yes" });
    expect(invalid.ok).toBe(false);

    // Pick editing (upsert) before close
    await submitPick({ eventId: event.id, fromRegistrationId: b1.id, toRegistrationId: a0.id, choice: "no" });
    await submitPick({ eventId: event.id, fromRegistrationId: b1.id, toRegistrationId: a0.id, choice: "yes" });

    expect(await closeEvent(event.id, new Date())).toBe("matched");
    expect(await closeEvent(event.id, new Date())).toBe("skipped"); // idempotent

    const matchRows = await db.select().from(matches).where(eq(matches.eventId, event.id));
    // a0↔b0 mutual; b1 changed to yes on a0 but a0 never picked b1 → no match
    expect(matchRows).toHaveLength(1);
    const pair = [matchRows[0].registrationAId, matchRows[0].registrationBId].sort();
    expect(pair).toEqual([a0.id, b0.id].sort());

    // Picks are closed once matched
    const late = await submitPick({ eventId: event.id, fromRegistrationId: a1.id, toRegistrationId: b0.id, choice: "yes" });
    expect(late.ok).toBe(false);

    // Reveal: exactly the two matched people get an email; idempotent on rerun
    const sent = await revealDueMatches(new Date());
    expect(sent).toBe(2);
    const revealEmails = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.eventId, event.id), eq(emailLog.type, "match_reveal")));
    expect(revealEmails.map((e) => e.registrationId).sort()).toEqual([a0.id, b0.id].sort());
    expect(await revealDueMatches(new Date())).toBe(0);

    // One-sided pickers (a1, b1) never hear anything
    const allEmails = await db.select().from(emailLog).where(eq(emailLog.eventId, event.id));
    expect(allEmails.some((e) => e.registrationId === a1.id || e.registrationId === b1.id)).toBe(false);
  });

  it("reveal waits for 9am the morning after", async () => {
    const { event, regs } = await seedFinishedNight();
    const [a0, , b0] = regs;
    await submitPick({ eventId: event.id, fromRegistrationId: a0.id, toRegistrationId: b0.id, choice: "yes" });
    await submitPick({ eventId: event.id, fromRegistrationId: b0.id, toRegistrationId: a0.id, choice: "yes" });
    await closeEvent(event.id, new Date());

    // Just after the event ended (same night) — too early, nothing sends
    const sameNight = new Date(event.startsAt.getTime() + 4 * 3600 * 1000);
    expect(await revealDueMatches(sameNight)).toBe(0);

    // Two days later — well past 9am the morning after
    expect(await revealDueMatches(new Date())).toBe(2);
  });

  it("purges picks 30 days post-event but keeps matches", async () => {
    const { event, regs } = await seedFinishedNight({ daysAgo: 31 });
    const [a0, , b0] = regs;
    await submitPick({ eventId: event.id, fromRegistrationId: a0.id, toRegistrationId: b0.id, choice: "yes" });
    await submitPick({ eventId: event.id, fromRegistrationId: b0.id, toRegistrationId: a0.id, choice: "yes" });
    await closeEvent(event.id, new Date());

    const purged = await purgeOldPicks(new Date());
    expect(purged).toBeGreaterThanOrEqual(2);

    const remainingPicks = await db.select().from(picks).where(eq(picks.eventId, event.id));
    expect(remainingPicks).toHaveLength(0);
    const remainingMatches = await db.select().from(matches).where(eq(matches.eventId, event.id));
    expect(remainingMatches).toHaveLength(1);

    // A recent event's picks survive the purge
    const { event: recent, regs: recentRegs } = await seedFinishedNight({ daysAgo: 2 });
    await submitPick({
      eventId: recent.id,
      fromRegistrationId: recentRegs[0].id,
      toRegistrationId: recentRegs[2].id,
      choice: "yes",
    });
    await purgeOldPicks(new Date());
    const recentPicks = await db.select().from(picks).where(eq(picks.eventId, recent.id));
    expect(recentPicks).toHaveLength(1);
  });
});

/**
 * Fast-forward the end of a seeded test night: fake attendees submit their
 * picks (everyone says yes to you), the event closes and computes mutual
 * matches, and the "morning after" reveal email sends immediately.
 *
 * Run AFTER you've made your own picks in the UI:
 *   npx tsx scripts/finish-night.ts <slug>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Usage: npx tsx scripts/finish-night.ts <slug>");

  const { asc, eq, inArray, max } = await import("drizzle-orm");
  const { db, assignments, events, matches, registrations, rounds, users } = await import(
    "../src/db"
  );
  const { closeEvent, revealDueMatches } = await import("../src/lib/matching");

  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  if (!event) throw new Error(`No event with slug ${slug}`);

  const regs = await db
    .select({ reg: registrations, email: users.email })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .where(eq(registrations.eventId, event.id));
  const fakeRegIds = new Set(
    regs.filter((r) => r.email.endsWith("@resend.dev")).map((r) => r.reg.id),
  );

  const eventRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.eventId, event.id))
    .orderBy(asc(rounds.number));
  if (eventRounds.length === 0) {
    throw new Error("No rounds yet — the schedule hasn't generated. Wait for the night to start.");
  }

  // Fakes pick yes on every real person they met, 50/50 on each other.
  const rows = await db
    .select()
    .from(assignments)
    .where(inArray(assignments.roundId, eventRounds.map((r) => r.id)));
  const { picks } = await import("../src/db");
  for (const a of rows) {
    if (!a.registrationBId) continue;
    for (const [from, to] of [
      [a.registrationAId, a.registrationBId],
      [a.registrationBId, a.registrationAId],
    ] as const) {
      if (!fakeRegIds.has(from)) continue; // your picks are yours
      const bothFake = fakeRegIds.has(to);
      const choice = !bothFake || Math.random() < 0.5 ? "yes" : "no";
      await db
        .insert(picks)
        .values({ eventId: event.id, fromRegistrationId: from, toRegistrationId: to, choice })
        .onConflictDoNothing();
    }
  }

  if (event.status === "live") {
    const [{ lastEnd }] = await db
      .select({ lastEnd: max(rounds.scheduledEndAt) })
      .from(rounds)
      .where(eq(rounds.eventId, event.id));
    const forcedNow = new Date(lastEnd!.getTime() + 16 * 60 * 1000);
    const closed = await closeEvent(event.id, forcedNow);
    console.log(`Close: ${closed}`);
  } else {
    console.log(`Close: already ${event.status}`);
  }

  // Reveal is normally 9am the morning after — force well past it.
  const sent = await revealDueMatches(new Date(event.startsAt.getTime() + 48 * 3600 * 1000));
  const matchRows = await db.select().from(matches).where(eq(matches.eventId, event.id));
  console.log(`Matches: ${matchRows.length} · reveal emails sent: ${sent}`);
  console.log(`Check your inbox, and /e/${slug}/matches on the site.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

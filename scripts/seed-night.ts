/**
 * Seed a compressed live-night test event you can play on your phone.
 *
 * Creates a tipped event that started 2 minutes ago with short rounds,
 * 3 fake checked-in attendees on your side and 4 on the other side, and a
 * confirmed registration for YOU (you tap "I'm here" yourself).
 *
 * Usage: npx tsx scripts/seed-night.ts [email] [roundSec] [breakSec]
 * Then open /e/<slug>/tonight, check in, and wait for the first round —
 * the schedule generates automatically 10 minutes after "start".
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const FAKE_NAMES_A = ["Marcus", "Dev", "Tom"];
const FAKE_NAMES_B = ["Priya", "Elena", "Jess", "Nadia"];

async function main() {
  const email = process.argv[2] ?? "zorfling@gmail.com";
  const roundSec = Number(process.argv[3] ?? 60);
  const breakSec = Number(process.argv[4] ?? 20);

  const { eq } = await import("drizzle-orm");
  const { db, buckets, events, registrations, users } = await import("../src/db");
  const { shortId } = await import("../src/lib/slug");

  const [me] = await db.select().from(users).where(eq(users.email, email));
  if (!me) throw new Error(`No user with email ${email} — sign in on the site first`);
  if (!me.name || !me.photoUrl) throw new Error("Complete your profile (name + photo) first");

  const now = Date.now();
  const startsAt = new Date(now - 2 * 60 * 1000); // check-in open, schedule gen in ~8 min

  const slug = `test-${shortId(6)}`;
  const [event] = await db
    .insert(events)
    .values({
      creatorId: me.id,
      slug,
      title: "Night-flow test run",
      city: "Testville",
      venueName: "Your couch",
      venueAddress: "1 Test St",
      venueNotes: "Not a real event — safe to play with",
      startsAt,
      tipDeadlineAt: new Date(now - 6 * 3600 * 1000),
      status: "tipped",
      roundLengthSec: roundSec,
      breakLengthSec: breakSec,
    })
    .returning();

  const [bucketA, bucketB] = await db
    .insert(buckets)
    .values([
      { eventId: event.id, label: "Side A", priceCents: 1000, sortOrder: 0, minSize: 3 },
      { eventId: event.id, label: "Side B", priceCents: 1000, sortOrder: 1, minSize: 3 },
    ])
    .returning();

  // You: confirmed, on Side A — check in from the UI like a real guest.
  await db.insert(registrations).values({
    eventId: event.id,
    bucketId: bucketA.id,
    userId: me.id,
    state: "confirmed",
    manageToken: shortId(24),
  });

  // Fakes: already checked in, with real-looking photos gendered to match
  // their names (randomuser.me portraits are gendered by URL path).
  let avatar = 20;
  for (const [bucketId, names, portraitDir] of [
    [bucketA.id, FAKE_NAMES_A, "men"],
    [bucketB.id, FAKE_NAMES_B, "women"],
  ] as const) {
    for (const name of names) {
      const [fake] = await db
        .insert(users)
        .values({
          email: `delivered+${name.toLowerCase()}-${shortId(4)}@resend.dev`,
          name,
          photoUrl: `https://randomuser.me/api/portraits/${portraitDir}/${avatar++}.jpg`,
        })
        .returning();
      await db.insert(registrations).values({
        eventId: event.id,
        bucketId,
        userId: fake.id,
        state: "checked_in",
        manageToken: shortId(24),
        checkedInAt: new Date(now - 60 * 1000),
      });
    }
  }

  const appUrl = process.env.APP_URL?.includes("localhost")
    ? "https://tipped-app.netlify.app"
    : process.env.APP_URL;
  console.log(`\nNight seeded. On your phone, open:\n\n  ${appUrl}/e/${slug}/tonight\n`);
  console.log(`1. Tap "I'm here" within the next ~8 minutes.`);
  console.log(`2. The night starts automatically ~8 minutes from now (rounds of ${roundSec}s, ${breakSec}s breaks — 4 rounds ≈ ${Math.round((4 * (roundSec + breakSec)) / 60)} min).`);
  console.log(`3. Pick yes/no after each round, and on the wrap-up screen.`);
  console.log(`4. When you're done picking: npx tsx scripts/finish-night.ts ${slug}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

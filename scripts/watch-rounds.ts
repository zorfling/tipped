import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const slug = process.argv[2];
  const { eq, asc } = await import("drizzle-orm");
  const { db, events, rounds } = await import("../src/db");
  for (;;) {
    const [event] = await db.select().from(events).where(eq(events.slug, slug));
    const r = await db.select().from(rounds).where(eq(rounds.eventId, event.id)).orderBy(asc(rounds.number));
    if (r.length > 0) {
      console.log(`SCHEDULE GENERATED: status=${event.status} rounds=${r.length} first=${r[0].scheduledStartAt.toISOString()}`);
      process.exit(0);
    }
    await new Promise((res) => setTimeout(res, 15000));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });

/** Remove the smoke-test demo data created during the autonomous build session. */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { inArray, eq } = await import("drizzle-orm");
  const { db, buckets, emailLog, events, registrations, users } = await import("../src/db");

  const demoEmails = [
    "demo@tipped.local",
    "joiner@tipped.local",
    "authtest@tipped.local",
  ];
  const demoUsers = await db.select().from(users).where(inArray(users.email, demoEmails));
  const demoUserIds = demoUsers.map((u) => u.id);

  const demoEvents = demoUserIds.length
    ? await db.select().from(events).where(inArray(events.creatorId, demoUserIds))
    : [];
  const demoEventIds = demoEvents.map((e) => e.id);

  if (demoEventIds.length) {
    await db.delete(emailLog).where(inArray(emailLog.eventId, demoEventIds));
    await db.delete(registrations).where(inArray(registrations.eventId, demoEventIds));
    await db.delete(buckets).where(inArray(buckets.eventId, demoEventIds));
    await db.delete(events).where(inArray(events.id, demoEventIds));
  }
  for (const id of demoUserIds) {
    await db.delete(registrations).where(eq(registrations.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  console.log(
    `Removed ${demoEvents.length} demo event(s) (${demoEvents.map((e) => e.slug).join(", ") || "none"}) and ${demoUsers.length} demo user(s).`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

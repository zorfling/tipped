/** M1 smoke: create a demo user + event via the real creation path, print the slug. */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { upsertUserByEmailForScripts } = await import("./script-db");
  const { createEventForUser } = await import("../src/lib/createEvent");

  const user = await upsertUserByEmailForScripts("demo@tipped.local", {
    name: "Demo",
    photoUrl: "/api/photos/demo",
  });

  const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const result = await createEventForUser(user.id, {
    title: "Smoke Test Speed Dating",
    city: "Brisbane",
    venueName: "The Gresham",
    venueAddress: "308 Queen St",
    venueNotes: "Back bar",
    startsAt,
    priceCents: 2500,
    bucketALabel: "Side A",
    bucketBLabel: "Side B",
    myBucket: "a",
  });

  if (!result.ok) throw new Error(result.error);
  console.log(`SLUG=${result.slug}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

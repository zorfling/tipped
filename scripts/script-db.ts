import { eq } from "drizzle-orm";
import { db, users, type User } from "../src/db";

export async function upsertUserByEmailForScripts(
  email: string,
  fields: { name?: string; photoUrl?: string } = {},
): Promise<User> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email, ...fields }).returning();
  return created;
}

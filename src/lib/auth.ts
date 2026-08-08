import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@/db";

const SESSION_COOKIE = "tipped_session";
const MAGIC_TTL = "15m";
const SESSION_TTL = "30d";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signMagicToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(MAGIC_TTL)
    .sign(secret());
}

export async function verifyMagicToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== "magic" || typeof payload.email !== "string") return null;
    return payload.email;
  } catch {
    return null;
  }
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ uid: userId, purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== "session" || typeof payload.uid !== "string") return null;
    return payload.uid;
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<User | null> {
  const uid = await getSessionUserId();
  if (!uid) return null;
  const [user] = await db.select().from(users).where(eq(users.id, uid));
  return user ?? null;
}

/** Find-or-create a user by email (called from the magic-link callback). */
export async function upsertUserByEmail(email: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email: normalized }).returning();
  return created;
}

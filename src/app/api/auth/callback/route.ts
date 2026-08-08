import { NextRequest, NextResponse } from "next/server";
import { createSession, upsertUserByEmail, verifyMagicToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const email = token ? await verifyMagicToken(token) : null;
  if (!email) {
    return NextResponse.redirect(new URL("/login?error=expired", process.env.APP_URL));
  }
  const user = await upsertUserByEmail(email);
  await createSession(user.id);
  const safeNext = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, process.env.APP_URL));
}

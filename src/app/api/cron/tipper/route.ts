import { NextRequest, NextResponse } from "next/server";
import { runTipper } from "@/lib/tipper";

export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return (
    header === `Bearer ${secret}` || req.nextUrl.searchParams.get("secret") === secret
  );
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runTipper();
  return NextResponse.json(result);
}

export const POST = GET;

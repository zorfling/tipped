import { NextRequest, NextResponse } from "next/server";
import { gateSignup, type CompositionConfig } from "@/lib/composition";
import { getBucketTallies, getEventBySlug } from "@/lib/events";

export interface TallyBucket {
  id: string;
  label: string;
  minSize: number;
  maxSize: number;
  priceCents: number;
  activeCount: number;
  waitlistCount: number;
  cta: "join" | "waitlist" | "sold_out";
}

export interface TallyResponse {
  status: string;
  tipDeadlineAt: string;
  buckets: TallyBucket[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tallies = await getBucketTallies(event.id);
  const cfg: CompositionConfig = {
    buckets: tallies.map((b) => ({ id: b.id, minSize: b.minSize, maxSize: b.maxSize })),
    maxImbalance: event.maxImbalance,
  };
  const counts = Object.fromEntries(tallies.map((b) => [b.id, b.activeCount]));

  const body: TallyResponse = {
    status: event.status,
    tipDeadlineAt: event.tipDeadlineAt.toISOString(),
    buckets: tallies.map((b) => ({
      id: b.id,
      label: b.label,
      minSize: b.minSize,
      maxSize: b.maxSize,
      priceCents: b.priceCents,
      activeCount: b.activeCount,
      waitlistCount: b.waitlistCount,
      cta:
        b.activeCount >= b.maxSize
          ? "sold_out"
          : gateSignup(cfg, counts, b.id) === "reserved"
            ? "join"
            : "waitlist",
    })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

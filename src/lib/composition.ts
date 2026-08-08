/**
 * Composition engine for Tipped: pure gating/tip/promotion logic over
 * per-bucket active registration counts. No I/O, no mutation of inputs.
 */

export interface BucketSpec {
  id: string;
  minSize: number;
  maxSize: number;
}

export interface CompositionConfig {
  buckets: BucketSpec[];
  maxImbalance: number;
}

export type ActiveCounts = Record<string, number>; // bucketId -> active count

export interface WaitlistEntry {
  registrationId: string;
  bucketId: string;
  waitlistedAt: Date;
}

function requireBucket(cfg: CompositionConfig, bucketId: string): BucketSpec {
  const bucket = cfg.buckets.find((b) => b.id === bucketId);
  if (bucket === undefined) {
    throw new Error(`Unknown bucket id: ${bucketId}`);
  }
  return bucket;
}

function assertKnownCountKeys(cfg: CompositionConfig, counts: ActiveCounts): void {
  for (const bucketId of Object.keys(counts)) {
    requireBucket(cfg, bucketId);
  }
}

function activeCount(counts: ActiveCounts, bucketId: string): number {
  return counts[bucketId] ?? 0;
}

function withIncrement(counts: ActiveCounts, bucketId: string): ActiveCounts {
  return { ...counts, [bucketId]: activeCount(counts, bucketId) + 1 };
}

export function imbalance(cfg: CompositionConfig, counts: ActiveCounts): number {
  assertKnownCountKeys(cfg, counts);
  if (cfg.buckets.length === 0) {
    return 0;
  }
  const values = cfg.buckets.map((b) => activeCount(counts, b.id));
  return Math.max(...values) - Math.min(...values);
}

export function gateSignup(
  cfg: CompositionConfig,
  counts: ActiveCounts,
  bucketId: string,
): "reserved" | "waitlisted" {
  assertKnownCountKeys(cfg, counts);
  const bucket = requireBucket(cfg, bucketId);
  if (activeCount(counts, bucketId) >= bucket.maxSize) {
    return "waitlisted";
  }
  // Only the post-signup imbalance matters: a signup into a lagging bucket is
  // allowed even when the current imbalance already exceeds the limit.
  if (imbalance(cfg, withIncrement(counts, bucketId)) > cfg.maxImbalance) {
    return "waitlisted";
  }
  return "reserved";
}

export function isSatisfied(cfg: CompositionConfig, counts: ActiveCounts): boolean {
  assertKnownCountKeys(cfg, counts);
  return (
    cfg.buckets.every((b) => activeCount(counts, b.id) >= b.minSize) &&
    imbalance(cfg, counts) <= cfg.maxImbalance
  );
}

// waitlistedAt asc, then registrationId asc (codepoint order): a total,
// deterministic order regardless of the input array's ordering.
function byPriority(a: WaitlistEntry, b: WaitlistEntry): number {
  const byTime = a.waitlistedAt.getTime() - b.waitlistedAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  if (a.registrationId < b.registrationId) return -1;
  if (a.registrationId > b.registrationId) return 1;
  return 0;
}

export function promotionCandidate(
  cfg: CompositionConfig,
  counts: ActiveCounts,
  waitlist: WaitlistEntry[],
): WaitlistEntry | null {
  assertKnownCountKeys(cfg, counts);
  // Validate every entry up front so a bad bucketId throws deterministically,
  // not only when the scan happens to reach it.
  for (const entry of waitlist) {
    requireBucket(cfg, entry.bucketId);
  }
  // Promoting an entry is admissible under exactly the conditions that a
  // fresh signup into its bucket would be reserved.
  for (const entry of [...waitlist].sort(byPriority)) {
    if (gateSignup(cfg, counts, entry.bucketId) === "reserved") {
      return entry;
    }
  }
  return null;
}

export function promotionPlan(
  cfg: CompositionConfig,
  counts: ActiveCounts,
  waitlist: WaitlistEntry[],
): WaitlistEntry[] {
  let current: ActiveCounts = { ...counts };
  const remaining = [...waitlist];
  const plan: WaitlistEntry[] = [];
  // Each iteration removes one entry from `remaining`, so this terminates.
  for (;;) {
    const next = promotionCandidate(cfg, current, remaining);
    if (next === null) {
      return plan;
    }
    plan.push(next);
    current = withIncrement(current, next.bucketId);
    // Remove by object identity so duplicate registrationIds cannot alias.
    remaining.splice(remaining.indexOf(next), 1);
  }
}

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  type ActiveCounts,
  type CompositionConfig,
  type WaitlistEntry,
  gateSignup,
  imbalance,
  isSatisfied,
  promotionCandidate,
  promotionPlan,
} from "./composition";

const BASE_TIME = 1_700_000_000_000;

function makeCfg(
  maxImbalance: number,
  ...buckets: Array<[id: string, minSize: number, maxSize: number]>
): CompositionConfig {
  return {
    maxImbalance,
    buckets: buckets.map(([id, minSize, maxSize]) => ({ id, minSize, maxSize })),
  };
}

function entry(registrationId: string, bucketId: string, ageMs: number): WaitlistEntry {
  return { registrationId, bucketId, waitlistedAt: new Date(BASE_TIME + ageMs) };
}

function applyPlan(counts: ActiveCounts, plan: WaitlistEntry[]): ActiveCounts {
  const next = { ...counts };
  for (const e of plan) {
    next[e.bucketId] = (next[e.bucketId] ?? 0) + 1;
  }
  return next;
}

const ids = (plan: WaitlistEntry[]): string[] => plan.map((e) => e.registrationId);

describe("imbalance", () => {
  it("returns max minus min active count for two buckets", () => {
    const cfg = makeCfg(2, ["a", 0, 10], ["b", 0, 10]);
    expect(imbalance(cfg, { a: 3, b: 1 })).toBe(2);
  });

  it("treats missing bucket keys as zero", () => {
    const cfg = makeCfg(2, ["a", 0, 10], ["b", 0, 10]);
    expect(imbalance(cfg, { a: 3 })).toBe(3);
    expect(imbalance(cfg, {})).toBe(0);
  });

  it("is computed across more than two buckets", () => {
    const cfg = makeCfg(2, ["a", 0, 10], ["b", 0, 10], ["c", 0, 10]);
    expect(imbalance(cfg, { a: 5, b: 2, c: 4 })).toBe(3);
    expect(imbalance(cfg, { a: 5, b: 5 })).toBe(5); // c missing -> 0
  });

  it("throws on a counts key that is not a configured bucket", () => {
    const cfg = makeCfg(2, ["a", 0, 10], ["b", 0, 10]);
    expect(() => imbalance(cfg, { a: 1, ghost: 2 })).toThrow(/ghost/);
  });
});

describe("gateSignup", () => {
  const cfg = makeCfg(2, ["a", 4, 10], ["b", 4, 10]);

  it("reserves a basic signup with room and balance", () => {
    expect(gateSignup(cfg, {}, "a")).toBe("reserved");
    expect(gateSignup(cfg, { a: 1, b: 1 }, "b")).toBe("reserved");
  });

  it("waitlists when the bucket is at maxSize", () => {
    const small = makeCfg(5, ["a", 0, 3], ["b", 0, 3]);
    expect(gateSignup(small, { a: 3, b: 3 }, "a")).toBe("waitlisted");
    expect(gateSignup(small, { a: 4, b: 4 }, "a")).toBe("waitlisted"); // defensive: over max
  });

  it("at the imbalance limit, waitlists the leading side but still reserves the lagging side", () => {
    // imbalance is exactly 2 (== maxImbalance): one more on "a" would make it 3.
    expect(gateSignup(cfg, { a: 3, b: 1 }, "a")).toBe("waitlisted");
    expect(gateSignup(cfg, { a: 3, b: 1 }, "b")).toBe("reserved");
  });

  it("reserves into the lagging bucket even when current imbalance already exceeds the limit", () => {
    // imbalance 3 > maxImbalance 2, but adding to "b" brings it back to 2.
    expect(gateSignup(cfg, { a: 4, b: 1 }, "b")).toBe("reserved");
    expect(gateSignup(cfg, { a: 4, b: 1 }, "a")).toBe("waitlisted");
  });

  it("gates against the global minimum across all buckets", () => {
    const three = makeCfg(1, ["a", 0, 10], ["b", 0, 10], ["c", 0, 10]);
    // c is empty, so a (already at 1) cannot go to 2.
    expect(gateSignup(three, { a: 1, b: 1 }, "a")).toBe("waitlisted");
    expect(gateSignup(three, { a: 1, b: 1 }, "c")).toBe("reserved");
  });

  it("throws on an unknown bucketId", () => {
    expect(() => gateSignup(cfg, {}, "ghost")).toThrow(/ghost/);
  });
});

describe("isSatisfied", () => {
  const cfg = makeCfg(2, ["a", 4, 10], ["b", 3, 10]);

  it("is true when every bucket is at exactly minSize and imbalance is within limit", () => {
    expect(isSatisfied(cfg, { a: 4, b: 3 })).toBe(true);
  });

  it("is false when any bucket is one short of minSize", () => {
    expect(isSatisfied(cfg, { a: 3, b: 3 })).toBe(false);
    expect(isSatisfied(cfg, { a: 4, b: 2 })).toBe(false);
  });

  it("is false when minimums are met but imbalance exceeds the limit", () => {
    expect(isSatisfied(cfg, { a: 7, b: 4 })).toBe(false);
  });

  it("is true at exactly maxImbalance", () => {
    expect(isSatisfied(cfg, { a: 6, b: 4 })).toBe(true);
  });

  it("treats a missing bucket count as zero (unsatisfied when minSize > 0)", () => {
    expect(isSatisfied(cfg, { a: 4 })).toBe(false);
  });

  it("throws on a counts key that is not a configured bucket", () => {
    expect(() => isSatisfied(cfg, { a: 4, b: 3, ghost: 1 })).toThrow(/ghost/);
  });
});

describe("promotionCandidate", () => {
  const cfg = makeCfg(1, ["a", 0, 10], ["b", 0, 10]);

  it("returns null for an empty waitlist", () => {
    expect(promotionCandidate(cfg, { a: 1, b: 1 }, [])).toBeNull();
  });

  it("picks the oldest promotable entry", () => {
    const waitlist = [entry("r2", "a", 200), entry("r1", "b", 100)];
    expect(promotionCandidate(cfg, {}, waitlist)?.registrationId).toBe("r1");
  });

  it("skips an older imbalance-blocked entry in favour of a younger one on the other side", () => {
    const waitlist = [entry("old-a", "a", 0), entry("young-b", "b", 500)];
    // a is already one ahead: promoting old-a would push imbalance to 2 > 1.
    expect(promotionCandidate(cfg, { a: 3, b: 2 }, waitlist)?.registrationId).toBe("young-b");
  });

  it("skips an older entry whose bucket is full in favour of a younger one elsewhere", () => {
    const capped = makeCfg(5, ["a", 0, 3], ["b", 0, 10]);
    const waitlist = [entry("old-a", "a", 0), entry("young-b", "b", 500)];
    expect(promotionCandidate(capped, { a: 3, b: 2 }, waitlist)?.registrationId).toBe("young-b");
  });

  it("returns null when no entry is promotable", () => {
    const waitlist = [entry("r1", "a", 0), entry("r2", "a", 100)];
    // Only a-side waitlisted, and a is already at the imbalance limit.
    expect(promotionCandidate(cfg, { a: 3, b: 2 }, waitlist)).toBeNull();
  });

  it("breaks waitlistedAt ties by registrationId ascending, regardless of array order", () => {
    const forward = [entry("r1", "a", 0), entry("r2", "b", 0)];
    const reversed = [entry("r2", "b", 0), entry("r1", "a", 0)];
    expect(promotionCandidate(cfg, {}, forward)?.registrationId).toBe("r1");
    expect(promotionCandidate(cfg, {}, reversed)?.registrationId).toBe("r1");
  });

  it("does not mutate the waitlist array", () => {
    const waitlist = [entry("r2", "a", 200), entry("r1", "b", 100)];
    promotionCandidate(cfg, {}, waitlist);
    expect(ids(waitlist)).toEqual(["r2", "r1"]);
  });

  it("throws on a waitlist entry with an unknown bucket, even when another entry is promotable", () => {
    const waitlist = [entry("r1", "a", 0), entry("r2", "ghost", 100)];
    expect(() => promotionCandidate(cfg, {}, waitlist)).toThrow(/ghost/);
  });
});

describe("promotionPlan", () => {
  const cfg = makeCfg(1, ["a", 0, 10], ["b", 0, 10]);

  it("returns an empty plan for an empty waitlist", () => {
    expect(promotionPlan(cfg, { a: 2, b: 2 }, [])).toEqual([]);
  });

  it("cascades: a cancellation on the lagging side unlocks alternating promotions on both sides", () => {
    // Was a=4/b=4; a b-side cancellation left a=4, b=3. Oldest waiter is on a,
    // but it can only be promoted after b catches up — and so on, alternating.
    const waitlist = [
      entry("a1", "a", 0),
      entry("b1", "b", 100),
      entry("a2", "a", 200),
      entry("b2", "b", 300),
    ];
    const plan = promotionPlan(cfg, { a: 4, b: 3 }, waitlist);
    expect(ids(plan)).toEqual(["b1", "a1", "b2", "a2"]);
  });

  it("stops at bucket capacity", () => {
    const capped = makeCfg(5, ["a", 0, 3], ["b", 0, 3]);
    const waitlist = [entry("a1", "a", 0), entry("a2", "a", 100), entry("b1", "b", 200)];
    const plan = promotionPlan(capped, { a: 2, b: 3 }, waitlist);
    expect(ids(plan)).toEqual(["a1"]);
  });

  it("is deterministic: shuffled input yields the same plan", () => {
    const waitlist = [
      entry("a1", "a", 0),
      entry("b1", "b", 100),
      entry("a2", "a", 200),
      entry("b2", "b", 300),
    ];
    const shuffled = [waitlist[3], waitlist[1], waitlist[0], waitlist[2]];
    expect(ids(promotionPlan(cfg, { a: 4, b: 3 }, shuffled))).toEqual(
      ids(promotionPlan(cfg, { a: 4, b: 3 }, waitlist)),
    );
  });

  it("breaks full ties (same waitlistedAt) by registrationId ascending", () => {
    const waitlist = [entry("r3", "a", 0), entry("r1", "b", 0), entry("r2", "a", 0)];
    const plan = promotionPlan(cfg, {}, waitlist);
    expect(ids(plan)).toEqual(["r1", "r2", "r3"]);
  });

  it("does not mutate its inputs", () => {
    const counts = { a: 4, b: 3 };
    const waitlist = [entry("a1", "a", 0), entry("b1", "b", 100)];
    promotionPlan(cfg, counts, waitlist);
    expect(counts).toEqual({ a: 4, b: 3 });
    expect(ids(waitlist)).toEqual(["a1", "b1"]);
  });

  it("throws on a waitlist entry with an unknown bucket", () => {
    expect(() => promotionPlan(cfg, {}, [entry("r1", "ghost", 0)])).toThrow(/ghost/);
  });
});

describe("properties (fast-check)", () => {
  const BUCKET_IDS = ["a", "b", "c", "d"];

  const configArb: fc.Arbitrary<CompositionConfig> = fc
    .tuple(
      fc.array(fc.tuple(fc.nat(3), fc.nat(5)), { minLength: 2, maxLength: 4 }),
      fc.nat(4),
    )
    .map(([sizes, maxImbalance]) => ({
      maxImbalance,
      buckets: sizes.map(([minSize, extra], i) => ({
        id: BUCKET_IDS[i],
        minSize,
        maxSize: minSize + extra,
      })),
    }));

  interface Scenario {
    cfg: CompositionConfig;
    counts: ActiveCounts; // arbitrary within [0, maxSize]
    validCounts: ActiveCounts; // additionally satisfies imbalance <= maxImbalance
    waitlist: WaitlistEntry[];
  }

  const scenarioArb: fc.Arbitrary<Scenario> = configArb.chain((cfg) => {
    const minOfMaxSizes = Math.min(...cfg.buckets.map((b) => b.maxSize));
    return fc
      .tuple(
        fc.tuple(...cfg.buckets.map((b) => fc.nat(b.maxSize))),
        fc.nat(minOfMaxSizes),
        fc.tuple(...cfg.buckets.map(() => fc.nat(cfg.maxImbalance))),
        fc.array(fc.tuple(fc.nat(cfg.buckets.length - 1), fc.nat(1000)), { maxLength: 12 }),
      )
      .map(([freeCounts, base, offsets, rawEntries]) => ({
        cfg,
        counts: Object.fromEntries(cfg.buckets.map((b, i) => [b.id, freeCounts[i]])),
        // base <= every maxSize and each value lies in [base, base + maxImbalance],
        // so validCounts always respects both caps and the imbalance limit.
        validCounts: Object.fromEntries(
          cfg.buckets.map((b, i) => [b.id, Math.min(b.maxSize, base + offsets[i])]),
        ),
        waitlist: rawEntries.map(([bucketIndex, ageSec], i) => ({
          registrationId: `r${String(i).padStart(3, "0")}`,
          bucketId: cfg.buckets[bucketIndex].id,
          waitlistedAt: new Date(BASE_TIME + ageSec * 1000),
        })),
      }));
  });

  it("gateSignup === 'reserved' implies both constraints hold after the increment", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(3), ({ cfg, counts }, pick) => {
        const bucket = cfg.buckets[pick % cfg.buckets.length];
        if (gateSignup(cfg, counts, bucket.id) === "reserved") {
          const after = { ...counts, [bucket.id]: (counts[bucket.id] ?? 0) + 1 };
          expect(after[bucket.id]).toBeLessThanOrEqual(bucket.maxSize);
          expect(imbalance(cfg, after)).toBeLessThanOrEqual(cfg.maxImbalance);
        }
      }),
    );
  });

  it("promotionPlan never exceeds maxSize nor leaves imbalance above the limit, at any step", () => {
    fc.assert(
      fc.property(scenarioArb, ({ cfg, validCounts, waitlist }) => {
        const plan = promotionPlan(cfg, validCounts, waitlist);

        let current = { ...validCounts };
        for (const promoted of plan) {
          current = { ...current, [promoted.bucketId]: (current[promoted.bucketId] ?? 0) + 1 };
          for (const b of cfg.buckets) {
            expect(current[b.id] ?? 0).toBeLessThanOrEqual(b.maxSize);
          }
          expect(imbalance(cfg, current)).toBeLessThanOrEqual(cfg.maxImbalance);
        }

        // Plan entries are distinct waitlist members, and nothing more is promotable.
        expect(new Set(plan).size).toBe(plan.length);
        for (const promoted of plan) {
          expect(waitlist).toContain(promoted);
        }
        const remaining = waitlist.filter((e) => !plan.includes(e));
        expect(promotionCandidate(cfg, applyPlan(validCounts, plan), remaining)).toBeNull();
      }),
    );
  });
});

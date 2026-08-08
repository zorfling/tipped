import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { scheduleRounds, type Id, type Pair, type RoundPairing } from "./rotation";

function makeIds(prefix: string, n: number): Id[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** Collect "a|b" keys for every assigned (non-bye) pairing across the schedule. */
function assignedPairKeys(rounds: RoundPairing[][]): string[] {
  const keys: string[] = [];
  for (const round of rounds) {
    for (const pairing of round) {
      if (pairing.a !== null && pairing.b !== null) {
        keys.push(`${pairing.a}|${pairing.b}`);
      }
    }
  }
  return keys;
}

/** Count byes per participant id, keyed by id. */
function byeCounts(rounds: RoundPairing[][]): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const round of rounds) {
    for (const pairing of round) {
      if (pairing.b === null && pairing.a !== null) {
        counts.set(pairing.a, (counts.get(pairing.a) ?? 0) + 1);
      }
      if (pairing.a === null && pairing.b !== null) {
        counts.set(pairing.b, (counts.get(pairing.b) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Assert every participant appears exactly once in every round. */
function expectEveryoneOncePerRound(
  rounds: RoundPairing[][],
  sideA: Id[],
  sideB: Id[],
): void {
  for (const round of rounds) {
    const seenA: Id[] = [];
    const seenB: Id[] = [];
    for (const pairing of round) {
      if (pairing.a !== null) seenA.push(pairing.a);
      if (pairing.b !== null) seenB.push(pairing.b);
    }
    expect([...seenA].sort()).toEqual([...sideA].sort());
    expect([...seenB].sort()).toEqual([...sideB].sort());
  }
}

/** Assert every non-blocked pair meets exactly once and blocked pairs never. */
function expectMeetingMatrix(
  rounds: RoundPairing[][],
  sideA: Id[],
  sideB: Id[],
  blocks: Pair[],
): void {
  const blocked = new Set(blocks.map(([a, b]) => `${a}|${b}`));
  const met = new Map<string, number>();
  for (const key of assignedPairKeys(rounds)) {
    met.set(key, (met.get(key) ?? 0) + 1);
  }
  for (const a of sideA) {
    for (const b of sideB) {
      const key = `${a}|${b}`;
      const expected = blocked.has(key) ? undefined : 1;
      expect(met.get(key), `pair ${key}`).toBe(expected);
    }
  }
  // No assigned pairing outside A×B.
  for (const key of met.keys()) {
    const [a, b] = key.split("|");
    expect(sideA).toContain(a);
    expect(sideB).toContain(b);
  }
}

describe("scheduleRounds — unit", () => {
  it("throws when side A is empty", () => {
    expect(() => scheduleRounds([], makeIds("B", 3), [])).toThrow();
  });

  it("throws when side B is empty", () => {
    expect(() => scheduleRounds(makeIds("A", 3), [], [])).toThrow();
  });

  it("handles 1v1", () => {
    const rounds = scheduleRounds(["A0"], ["B0"], []);
    expect(rounds).toEqual([[{ a: "A0", b: "B0" }]]);
  });

  it("8v8 with no blocks: all 64 pairs meet exactly once over exactly 8 rounds, no byes", () => {
    const sideA = makeIds("A", 8);
    const sideB = makeIds("B", 8);
    const rounds = scheduleRounds(sideA, sideB, []);
    expect(rounds).toHaveLength(8);
    expectEveryoneOncePerRound(rounds, sideA, sideB);
    expectMeetingMatrix(rounds, sideA, sideB, []);
    expect(assignedPairKeys(rounds)).toHaveLength(64);
    expect(byeCounts(rounds).size).toBe(0);
  });

  it("8v6: byes spread evenly (per-side bye counts differ by at most 1)", () => {
    const sideA = makeIds("A", 8);
    const sideB = makeIds("B", 6);
    const rounds = scheduleRounds(sideA, sideB, []);
    expect(rounds).toHaveLength(8);
    expectEveryoneOncePerRound(rounds, sideA, sideB);
    expectMeetingMatrix(rounds, sideA, sideB, []);

    const counts = byeCounts(rounds);
    const aByes = sideA.map((id) => counts.get(id) ?? 0);
    const bByes = sideB.map((id) => counts.get(id) ?? 0);
    expect(Math.max(...aByes) - Math.min(...aByes)).toBeLessThanOrEqual(1);
    expect(Math.max(...bByes) - Math.min(...bByes)).toBeLessThanOrEqual(1);
    // Each A member meets all 6 B members over 8 rounds → exactly 2 byes each;
    // each B member meets all 8 A members over 8 rounds → 0 byes.
    expect(aByes).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(bByes).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("single block A3×B5: never assigned, everything else still meets exactly once", () => {
    const sideA = makeIds("A", 8);
    const sideB = makeIds("B", 8);
    const blocks: Pair[] = [["A3", "B5"]];
    const rounds = scheduleRounds(sideA, sideB, blocks);
    expect(rounds).toHaveLength(8);
    expectEveryoneOncePerRound(rounds, sideA, sideB);
    expectMeetingMatrix(rounds, sideA, sideB, blocks);
    // A3 and B5 each pick up an extra bye in the round where they would have met.
    const counts = byeCounts(rounds);
    expect(counts.get("A3")).toBe(1);
    expect(counts.get("B5")).toBe(1);
  });

  it("is deterministic for identical inputs", () => {
    const sideA = makeIds("A", 7);
    const sideB = makeIds("B", 5);
    const blocks: Pair[] = [
      ["A1", "B2"],
      ["A6", "B0"],
    ];
    const first = scheduleRounds(sideA, sideB, blocks);
    const second = scheduleRounds(sideA, sideB, blocks);
    expect(second).toEqual(first);
  });

  it("ignores blocks referencing unknown ids", () => {
    const sideA = makeIds("A", 3);
    const sideB = makeIds("B", 3);
    const rounds = scheduleRounds(sideA, sideB, [["A99", "B0"]]);
    expectMeetingMatrix(rounds, sideA, sideB, []);
  });
});

describe("scheduleRounds — properties", () => {
  const sidesArb = fc
    .record({
      nA: fc.integer({ min: 1, max: 12 }),
      nB: fc.integer({ min: 1, max: 12 }),
    })
    .map(({ nA, nB }) => ({
      sideA: makeIds("A", nA),
      sideB: makeIds("B", nB),
    }));

  const sidesWithBlocksArb = sidesArb.chain(({ sideA, sideB }) =>
    fc
      .uniqueArray(
        fc.tuple(
          fc.integer({ min: 0, max: sideA.length - 1 }),
          fc.integer({ min: 0, max: sideB.length - 1 }),
        ),
        {
          maxLength: sideA.length * sideB.length,
          selector: ([i, j]) => `${i}:${j}`,
        },
      )
      .map((indexPairs) => ({
        sideA,
        sideB,
        blocks: indexPairs.map(
          ([i, j]): Pair => [sideA[i], sideB[j]],
        ),
      })),
  );

  it("round count is max(|A|, |B|) for any sides and blocks", () => {
    fc.assert(
      fc.property(sidesWithBlocksArb, ({ sideA, sideB, blocks }) => {
        const rounds = scheduleRounds(sideA, sideB, blocks);
        expect(rounds).toHaveLength(Math.max(sideA.length, sideB.length));
      }),
    );
  });

  it("every participant appears exactly once per round (paired or bye)", () => {
    fc.assert(
      fc.property(sidesWithBlocksArb, ({ sideA, sideB, blocks }) => {
        const rounds = scheduleRounds(sideA, sideB, blocks);
        expectEveryoneOncePerRound(rounds, sideA, sideB);
      }),
    );
  });

  it("every non-blocked pair meets exactly once; blocked pairs are never assigned", () => {
    fc.assert(
      fc.property(sidesWithBlocksArb, ({ sideA, sideB, blocks }) => {
        const rounds = scheduleRounds(sideA, sideB, blocks);
        expectMeetingMatrix(rounds, sideA, sideB, blocks);
      }),
    );
  });

  it("with no blocks, same-side bye counts differ by at most 1", () => {
    fc.assert(
      fc.property(sidesArb, ({ sideA, sideB }) => {
        const rounds = scheduleRounds(sideA, sideB, []);
        const counts = byeCounts(rounds);
        const aByes = sideA.map((id) => counts.get(id) ?? 0);
        const bByes = sideB.map((id) => counts.get(id) ?? 0);
        expect(Math.max(...aByes) - Math.min(...aByes)).toBeLessThanOrEqual(1);
        expect(Math.max(...bByes) - Math.min(...bByes)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("is deterministic: identical inputs yield identical schedules", () => {
    fc.assert(
      fc.property(sidesWithBlocksArb, ({ sideA, sideB, blocks }) => {
        expect(scheduleRounds(sideA, sideB, blocks)).toEqual(
          scheduleRounds(sideA, sideB, blocks),
        );
      }),
    );
  });
});

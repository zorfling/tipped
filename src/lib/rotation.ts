/**
 * Pure rotation scheduler for speed-dating rounds.
 *
 * Models the problem as bipartite edge colouring: build the complete bipartite
 * graph K_{|A|,|B|} minus blocked edges. By König's theorem a bipartite graph
 * is Δ-edge-colourable where Δ is the maximum degree, and here
 * Δ ≤ max(|A|, |B|). We colour every non-blocked edge with one of
 * max(|A|, |B|) colours using the standard constructive algorithm (greedy
 * assignment with alternating-path recolouring); the colour of an edge is the
 * round in which that pair meets. Participants with no edge of a given colour
 * get a bye that round.
 *
 * No DB imports — this module is pure.
 */

export type Id = string;

/** [sideA id, sideB id] — a blocked pair, never to be assigned. */
export type Pair = [Id, Id];

/** A pairing within a round; null on one side denotes a bye. */
export interface RoundPairing {
  a: Id | null;
  b: Id | null;
}

const NO_EDGE = -1;

/**
 * Schedule max(|A|, |B|) rounds so that every non-blocked A×B pair meets
 * exactly once, nobody is double-booked within a round, and every participant
 * appears exactly once per round (paired or as a bye).
 *
 * Deterministic: identical inputs always produce identical output.
 * Throws if either side is empty.
 */
export function scheduleRounds(
  sideA: Id[],
  sideB: Id[],
  blocks: Pair[],
): RoundPairing[][] {
  if (sideA.length === 0 || sideB.length === 0) {
    throw new Error("scheduleRounds: both sides must have at least one participant");
  }

  const nA = sideA.length;
  const nB = sideB.length;
  const roundCount = Math.max(nA, nB);

  // Index lookups (assumes ids are unique within a side).
  const indexA = new Map<Id, number>();
  sideA.forEach((id, i) => indexA.set(id, i));
  const indexB = new Map<Id, number>();
  sideB.forEach((id, j) => indexB.set(id, j));

  // Blocked edge set keyed by "i:j"; blocks referencing unknown ids are ignored.
  const blocked = new Set<string>();
  for (const [aId, bId] of blocks) {
    const i = indexA.get(aId);
    const j = indexB.get(bId);
    if (i !== undefined && j !== undefined) {
      blocked.add(`${i}:${j}`);
    }
  }

  // colourA[i][c] = index of the B partner that A_i meets in round c (or NO_EDGE).
  // colourB[j][c] = index of the A partner that B_j meets in round c (or NO_EDGE).
  const colourA: number[][] = sideA.map(() => new Array<number>(roundCount).fill(NO_EDGE));
  const colourB: number[][] = sideB.map(() => new Array<number>(roundCount).fill(NO_EDGE));

  const smallestFreeA = (i: number): number => colourA[i].indexOf(NO_EDGE);
  const smallestFreeB = (j: number): number => colourB[j].indexOf(NO_EDGE);

  const assign = (i: number, j: number, c: number): void => {
    colourA[i][c] = j;
    colourB[j][c] = i;
  };

  // Colour each non-blocked edge (i, j) in deterministic order.
  for (let i = 0; i < nA; i += 1) {
    for (let j = 0; j < nB; j += 1) {
      if (blocked.has(`${i}:${j}`)) continue;

      // Try the smallest colour free at both endpoints.
      let common = NO_EDGE;
      for (let c = 0; c < roundCount; c += 1) {
        if (colourA[i][c] === NO_EDGE && colourB[j][c] === NO_EDGE) {
          common = c;
          break;
        }
      }
      if (common !== NO_EDGE) {
        assign(i, j, common);
        continue;
      }

      // Otherwise: alpha is free at i (but used at j), beta is free at j (but
      // used at i). Flip the maximal alternating alpha/beta path starting at j;
      // by the standard König argument (bipartite parity) the path can never
      // reach i, so afterwards alpha is free at both endpoints.
      const alpha = smallestFreeA(i);
      const beta = smallestFreeB(j);
      // Both must exist: each endpoint has fewer than roundCount coloured edges
      // because its total degree is at most roundCount and (i, j) is uncoloured.

      // Collect the alternating path as edges [aIdx, bIdx, colour].
      const pathEdges: Array<[number, number, number]> = [];
      let onSideB = true;
      let v = j;
      let c = alpha;
      for (;;) {
        const partner = onSideB ? colourB[v][c] : colourA[v][c];
        if (partner === NO_EDGE) break;
        pathEdges.push(onSideB ? [partner, v, c] : [v, partner, c]);
        v = partner;
        onSideB = !onSideB;
        c = c === alpha ? beta : alpha;
      }

      // Swap alpha and beta along the path.
      for (const [ai, bj, col] of pathEdges) {
        colourA[ai][col] = NO_EDGE;
        colourB[bj][col] = NO_EDGE;
      }
      for (const [ai, bj, col] of pathEdges) {
        const swapped = col === alpha ? beta : alpha;
        colourA[ai][swapped] = bj;
        colourB[bj][swapped] = ai;
      }

      assign(i, j, alpha);
    }
  }

  // Emit rounds: side A entries in input order (paired or bye), then side B
  // byes in input order. Every participant appears exactly once per round.
  const rounds: RoundPairing[][] = [];
  for (let c = 0; c < roundCount; c += 1) {
    const round: RoundPairing[] = [];
    for (let i = 0; i < nA; i += 1) {
      const j = colourA[i][c];
      round.push({ a: sideA[i], b: j === NO_EDGE ? null : sideB[j] });
    }
    for (let j = 0; j < nB; j += 1) {
      if (colourB[j][c] === NO_EDGE) {
        round.push({ a: null, b: sideB[j] });
      }
    }
    rounds.push(round);
  }

  return rounds;
}

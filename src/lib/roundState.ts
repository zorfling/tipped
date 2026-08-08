/**
 * Pure derived state machine for the night of an event.
 *
 * The current phase is derived entirely from the injected `now` timestamp and
 * the scheduled round timestamps — never from a ticking process or a human
 * action. No DB imports — this module is pure.
 *
 * Boundary convention: inclusive start, exclusive end.
 */

export interface RoundRow {
  number: number;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}

/** Check-in opens startsAt−15min and closes startsAt+10min (grace). */
export interface EventTimes {
  startsAt: Date;
}

export type NightState =
  | { phase: "pre" } // before check-in opens
  | { phase: "checkin"; closesAt: Date } // check-in window open, schedule not yet generated
  | { phase: "awaiting_schedule" } // check-in closed, rounds not yet generated
  | { phase: "round"; round: RoundRow; endsAt: Date }
  | { phase: "break"; nextRound: RoundRow; startsAt: Date }
  | { phase: "before_first_round"; nextRound: RoundRow; startsAt: Date } // schedule exists, first round not started
  | { phase: "ended"; endedAt: Date }; // after final round's scheduledEndAt

const CHECKIN_OPENS_BEFORE_MS = 15 * 60 * 1000;
const CHECKIN_GRACE_AFTER_MS = 10 * 60 * 1000;

export function deriveNightState(
  now: Date,
  times: EventTimes,
  rounds: RoundRow[],
): NightState {
  const t = now.getTime();

  if (rounds.length === 0) {
    const opensAt = times.startsAt.getTime() - CHECKIN_OPENS_BEFORE_MS;
    const closesAt = times.startsAt.getTime() + CHECKIN_GRACE_AFTER_MS;
    if (t < opensAt) {
      return { phase: "pre" };
    }
    if (t < closesAt) {
      return { phase: "checkin", closesAt: new Date(closesAt) };
    }
    return { phase: "awaiting_schedule" };
  }

  const sorted = [...rounds].sort((x, y) => x.number - y.number);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (t < first.scheduledStartAt.getTime()) {
    return {
      phase: "before_first_round",
      nextRound: first,
      startsAt: first.scheduledStartAt,
    };
  }

  if (t >= last.scheduledEndAt.getTime()) {
    return { phase: "ended", endedAt: last.scheduledEndAt };
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const round = sorted[i];
    if (t >= round.scheduledStartAt.getTime() && t < round.scheduledEndAt.getTime()) {
      return { phase: "round", round, endsAt: round.scheduledEndAt };
    }
    const next = sorted[i + 1];
    if (
      next !== undefined &&
      t >= round.scheduledEndAt.getTime() &&
      t < next.scheduledStartAt.getTime()
    ) {
      return { phase: "break", nextRound: next, startsAt: next.scheduledStartAt };
    }
  }

  // Unreachable for well-formed schedules (every instant in
  // [first start, last end) falls in a round or a break), but keep a total
  // function: treat any gap anomaly as a break before the next round to start.
  const upcoming = sorted.find((r) => r.scheduledStartAt.getTime() > t);
  if (upcoming !== undefined) {
    return { phase: "break", nextRound: upcoming, startsAt: upcoming.scheduledStartAt };
  }
  return { phase: "ended", endedAt: last.scheduledEndAt };
}

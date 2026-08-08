import { describe, expect, it } from "vitest";
import {
  deriveNightState,
  type EventTimes,
  type RoundRow,
} from "./roundState";

const MIN = 60 * 1000;

/** Event starts at a fixed reference instant. */
const START = new Date("2026-08-08T19:00:00.000Z");
const times: EventTimes = { startsAt: START };

const at = (offsetMinutes: number): Date =>
  new Date(START.getTime() + offsetMinutes * MIN);

function round(number: number, startMin: number, endMin: number): RoundRow {
  return {
    number,
    scheduledStartAt: at(startMin),
    scheduledEndAt: at(endMin),
  };
}

// Three rounds with breaks: [20, 25), [30, 35), [40, 45) minutes after start.
const rounds = [round(1, 20, 25), round(2, 30, 35), round(3, 40, 45)];

describe("deriveNightState — no rounds yet", () => {
  it("is pre before check-in opens", () => {
    expect(deriveNightState(at(-120), times, [])).toEqual({ phase: "pre" });
    expect(deriveNightState(at(-16), times, [])).toEqual({ phase: "pre" });
  });

  it("is pre one millisecond before check-in opens", () => {
    const justBefore = new Date(at(-15).getTime() - 1);
    expect(deriveNightState(justBefore, times, [])).toEqual({ phase: "pre" });
  });

  it("is checkin exactly at check-in open (inclusive start)", () => {
    expect(deriveNightState(at(-15), times, [])).toEqual({
      phase: "checkin",
      closesAt: at(10),
    });
  });

  it("is checkin during the window, including exactly at startsAt", () => {
    expect(deriveNightState(at(-5), times, [])).toEqual({
      phase: "checkin",
      closesAt: at(10),
    });
    expect(deriveNightState(at(0), times, [])).toEqual({
      phase: "checkin",
      closesAt: at(10),
    });
    expect(deriveNightState(at(9), times, [])).toEqual({
      phase: "checkin",
      closesAt: at(10),
    });
  });

  it("is awaiting_schedule exactly at check-in close (exclusive end)", () => {
    expect(deriveNightState(at(10), times, [])).toEqual({
      phase: "awaiting_schedule",
    });
  });

  it("is awaiting_schedule after the grace window", () => {
    expect(deriveNightState(at(60), times, [])).toEqual({
      phase: "awaiting_schedule",
    });
  });
});

describe("deriveNightState — schedule exists", () => {
  it("is before_first_round any time before the first round starts", () => {
    expect(deriveNightState(at(-30), times, rounds)).toEqual({
      phase: "before_first_round",
      nextRound: rounds[0],
      startsAt: at(20),
    });
    expect(deriveNightState(at(5), times, rounds)).toEqual({
      phase: "before_first_round",
      nextRound: rounds[0],
      startsAt: at(20),
    });
    const justBefore = new Date(at(20).getTime() - 1);
    expect(deriveNightState(justBefore, times, rounds)).toEqual({
      phase: "before_first_round",
      nextRound: rounds[0],
      startsAt: at(20),
    });
  });

  it("is round exactly at a round start (inclusive start)", () => {
    expect(deriveNightState(at(20), times, rounds)).toEqual({
      phase: "round",
      round: rounds[0],
      endsAt: at(25),
    });
  });

  it("is round inside a round window", () => {
    expect(deriveNightState(at(32), times, rounds)).toEqual({
      phase: "round",
      round: rounds[1],
      endsAt: at(35),
    });
  });

  it("is break exactly at a round end (exclusive end)", () => {
    expect(deriveNightState(at(25), times, rounds)).toEqual({
      phase: "break",
      nextRound: rounds[1],
      startsAt: at(30),
    });
  });

  it("is break between rounds", () => {
    expect(deriveNightState(at(37), times, rounds)).toEqual({
      phase: "break",
      nextRound: rounds[2],
      startsAt: at(40),
    });
  });

  it("is round when back-to-back rounds share a boundary instant", () => {
    const backToBack = [round(1, 20, 25), round(2, 25, 30)];
    expect(deriveNightState(at(25), times, backToBack)).toEqual({
      phase: "round",
      round: backToBack[1],
      endsAt: at(30),
    });
  });

  it("is ended exactly at the final round end (exclusive end)", () => {
    expect(deriveNightState(at(45), times, rounds)).toEqual({
      phase: "ended",
      endedAt: at(45),
    });
  });

  it("is ended after the final round end", () => {
    expect(deriveNightState(at(300), times, rounds)).toEqual({
      phase: "ended",
      endedAt: at(45),
    });
  });

  it("sorts unsorted rounds by number", () => {
    const shuffled = [rounds[2], rounds[0], rounds[1]];
    expect(deriveNightState(at(32), times, shuffled)).toEqual({
      phase: "round",
      round: rounds[1],
      endsAt: at(35),
    });
    expect(deriveNightState(at(5), times, shuffled)).toEqual({
      phase: "before_first_round",
      nextRound: rounds[0],
      startsAt: at(20),
    });
    expect(deriveNightState(at(45), times, shuffled)).toEqual({
      phase: "ended",
      endedAt: at(45),
    });
  });

  it("handles a single-round schedule across all phases", () => {
    const single = [round(1, 20, 25)];
    expect(deriveNightState(at(0), times, single)).toEqual({
      phase: "before_first_round",
      nextRound: single[0],
      startsAt: at(20),
    });
    expect(deriveNightState(at(20), times, single)).toEqual({
      phase: "round",
      round: single[0],
      endsAt: at(25),
    });
    const midRound = new Date(at(25).getTime() - 1);
    expect(deriveNightState(midRound, times, single)).toEqual({
      phase: "round",
      round: single[0],
      endsAt: at(25),
    });
    expect(deriveNightState(at(25), times, single)).toEqual({
      phase: "ended",
      endedAt: at(25),
    });
  });
});

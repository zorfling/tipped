import { and, asc, eq, or } from "drizzle-orm";
import { db, assignments, registrations, rounds, users, type Event } from "@/db";
import { deriveNightState, type RoundRow } from "@/lib/roundState";
import { CHECKIN_GRACE_AFTER_MS, CHECKIN_OPENS_BEFORE_MS } from "@/lib/schedule";

export interface PartnerInfo {
  name: string | null;
  photoUrl: string | null;
}

export interface NightStatePayload {
  eventStatus: string;
  phase:
    | "pre"
    | "checkin"
    | "awaiting_schedule"
    | "before_first_round"
    | "round"
    | "break"
    | "ended"
    | "cancelled"
    | "not_attending";
  now: string;
  startsAt: string;
  checkedIn: boolean;
  canCheckIn: boolean;
  totalRounds: number;
  round?: { number: number; endsAt: string };
  nextRound?: { number: number; startsAt: string };
  /** During a round: your date (null = bye). During a break: who's next. */
  partner?: PartnerInfo | null;
  nextPartner?: PartnerInfo | null;
  myRegistrationId?: string;
  partnerRegistrationId?: string;
}

async function partnerFor(
  roundId: string,
  myRegId: string,
): Promise<{ info: PartnerInfo | null; regId: string | null }> {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.roundId, roundId),
        or(eq(assignments.registrationAId, myRegId), eq(assignments.registrationBId, myRegId)),
      ),
    );
  if (!assignment || assignment.registrationBId === null) return { info: null, regId: null };
  const partnerRegId =
    assignment.registrationAId === myRegId
      ? assignment.registrationBId
      : assignment.registrationAId;
  const [row] = await db
    .select({ name: users.name, photoUrl: users.photoUrl })
    .from(registrations)
    .innerJoin(users, eq(registrations.userId, users.id))
    .where(eq(registrations.id, partnerRegId));
  return { info: row ?? null, regId: partnerRegId };
}

export async function getNightState(
  event: Event,
  userId: string,
  now = new Date(),
): Promise<NightStatePayload> {
  const base: Omit<NightStatePayload, "phase"> = {
    eventStatus: event.status,
    now: now.toISOString(),
    startsAt: event.startsAt.toISOString(),
    checkedIn: false,
    canCheckIn: false,
    totalRounds: 0,
  };

  const [myReg] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, event.id), eq(registrations.userId, userId)));
  if (!myReg || !["confirmed", "checked_in"].includes(myReg.state)) {
    return { ...base, phase: "not_attending" };
  }
  base.myRegistrationId = myReg.id;
  base.checkedIn = myReg.state === "checked_in";

  if (["cancelled", "fizzled"].includes(event.status)) {
    return { ...base, phase: "cancelled" };
  }

  const roundRows = await db
    .select()
    .from(rounds)
    .where(eq(rounds.eventId, event.id))
    .orderBy(asc(rounds.number));
  base.totalRounds = roundRows.length;
  const roundIndex = new Map(roundRows.map((r) => [r.number, r.id]));
  const asRoundRow = (r: (typeof roundRows)[number]): RoundRow => ({
    number: r.number,
    scheduledStartAt: r.scheduledStartAt,
    scheduledEndAt: r.scheduledEndAt,
  });

  const derived = deriveNightState(
    now,
    { startsAt: event.startsAt },
    roundRows.map(asRoundRow),
  );

  const opens = event.startsAt.getTime() - CHECKIN_OPENS_BEFORE_MS;
  if (!base.checkedIn && myReg.state === "confirmed" && now.getTime() >= opens) {
    if (event.status === "tipped") {
      base.canCheckIn = true; // window stays open until the schedule generates
    } else if (event.status === "live") {
      const round2 = roundRows.find((r) => r.number === 2) ?? roundRows.at(-1);
      base.canCheckIn = Boolean(round2 && now.getTime() < round2.scheduledEndAt.getTime());
    }
  }

  switch (derived.phase) {
    case "pre":
      return { ...base, phase: "pre" };
    case "checkin":
      return { ...base, phase: "checkin" };
    case "awaiting_schedule":
      return { ...base, phase: "awaiting_schedule" };
    case "before_first_round":
    case "break": {
      const next = derived.phase === "break" ? derived.nextRound : derived.nextRound;
      const { info } = await partnerFor(roundIndex.get(next.number)!, myReg.id);
      return {
        ...base,
        phase: derived.phase,
        nextRound: { number: next.number, startsAt: next.scheduledStartAt.toISOString() },
        nextPartner: info,
      };
    }
    case "round": {
      const { info, regId } = await partnerFor(roundIndex.get(derived.round.number)!, myReg.id);
      return {
        ...base,
        phase: "round",
        round: { number: derived.round.number, endsAt: derived.endsAt.toISOString() },
        partner: info,
        partnerRegistrationId: regId ?? undefined,
      };
    }
    case "ended":
      return { ...base, phase: "ended" };
  }
}

import { eq } from "drizzle-orm";
import { db, users, type Event, type Registration } from "@/db";
import { sendEventEmail } from "@/lib/email";

function eventUrl(event: Event): string {
  return `${process.env.APP_URL}/e/${event.slug}`;
}

function whenLine(event: Event): string {
  return event.startsAt.toLocaleString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function emailOf(userId: string): Promise<string | null> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return user?.email ?? null;
}

export async function sendReservedEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "reserved",
    mail: {
      to,
      subject: `You're in — if it tips: ${event.title}`,
      html: `<p>You've got a spot at <strong>${event.title}</strong> (${whenLine(event)}, ${event.venueName}).</p>
<p><strong>You haven't been charged.</strong> Your card is only charged if enough people join both sides by the deadline. If it doesn't tip, the night's off and you pay nothing.</p>
<p><a href="${eventUrl(event)}">Watch the tally</a> — bring a friend for the other side to help it tip.</p>`,
    },
  });
}

export async function sendWaitlistedEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "waitlisted",
    mail: {
      to,
      subject: `You're on the waitlist: ${event.title}`,
      html: `<p>Your side is ahead right now, so you're on the waitlist for <strong>${event.title}</strong> (${whenLine(event)}).</p>
<p>Your card is saved but <strong>you won't be charged unless a spot opens and the event goes ahead</strong>. We'll email you the moment you're in.</p>
<p><a href="${eventUrl(event)}">Check the tally</a>.</p>`,
    },
  });
}

export async function sendPromotedEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "promoted",
    mail: {
      to,
      subject: `A spot opened — you're in (if it tips): ${event.title}`,
      html: `<p>Good news: a spot opened up and you've moved off the waitlist for <strong>${event.title}</strong> (${whenLine(event)}, ${event.venueName}).</p>
<p><strong>You still haven't been charged</strong> — that only happens if the event tips at the deadline.</p>
<p><a href="${eventUrl(event)}">See where it stands</a>.</p>`,
    },
  });
}

export async function sendSignupEmails(
  event: Event,
  reg: Registration,
  state: "reserved" | "waitlisted",
  promoted: Registration[],
): Promise<void> {
  if (state === "reserved") await sendReservedEmail(event, reg);
  else await sendWaitlistedEmail(event, reg);
  for (const p of promoted) await sendPromotedEmail(event, p);
}

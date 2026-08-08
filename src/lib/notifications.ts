import { eq } from "drizzle-orm";
import { db, users, type Event, type Registration } from "@/db";
import { sendEventEmail } from "@/lib/email";
import { makeIcs } from "@/lib/ics";

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

export async function sendTippedReceiptEmail(
  event: Event,
  reg: Registration,
  amountCents: number,
): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "tipped_receipt",
    mail: {
      to,
      subject: `It's on! ${event.title} — receipt inside`,
      html: `<p><strong>${event.title} tipped — it's happening.</strong></p>
<p>${whenLine(event)}<br>${event.venueName}, ${event.venueAddress}${event.venueNotes ? `<br><em>${event.venueNotes}</em>` : ""}</p>
<p>Your card was charged <strong>$${(amountCents / 100).toFixed(2)}</strong> as agreed when you joined. Calendar invite attached.</p>
<p>On the night, open <a href="${eventUrl(event)}">the event page</a> on your phone — it runs the whole thing.</p>`,
      attachments: [
        { filename: "tipped-event.ics", content: Buffer.from(makeIcs(event)).toString("base64") },
      ],
    },
  });
}

export async function sendFizzledEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "fizzled",
    mail: {
      to,
      subject: `It fizzled — you were never charged: ${event.title}`,
      html: `<p><strong>${event.title}</strong> didn't reach enough people on both sides by the deadline, so it's off.</p>
<p><strong>You were never charged.</strong> No money moved — that's the whole deal.</p>
<p>Someone will start another one soon — or <a href="${process.env.APP_URL}/create">you could</a>.</p>`,
    },
  });
}

export async function sendChargeFailedEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "charge_failed",
    mail: {
      to,
      subject: `Action needed — payment didn't go through: ${event.title}`,
      html: `<p><strong>${event.title} tipped</strong> — but your card payment didn't go through.</p>
<p>Fix it within 24 hours to keep your spot:</p>
<p><a href="${process.env.APP_URL}/fix/${reg.manageToken}">Fix payment</a></p>
<p>If it isn't resolved before the night, you won't be in the lineup.</p>`,
    },
  });
}

export async function sendReminderEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "day_before_reminder",
    mail: {
      to,
      subject: `Tomorrow: ${event.title}`,
      html: `<p>Quick reminder — <strong>${event.title}</strong> is on ${whenLine(event)}.</p>
<p>${event.venueName}, ${event.venueAddress}${event.venueNotes ? `<br><em>Finding the group: ${event.venueNotes}</em>` : ""}</p>
<p>Bring your phone with <a href="${eventUrl(event)}">the event page</a> open — check-in starts 15 minutes before, and your phone tells you who you're meeting each round.</p>`,
    },
  });
}

export async function sendEventCancelledEmail(event: Event, reg: Registration): Promise<void> {
  const to = await emailOf(reg.userId);
  if (!to) return;
  await sendEventEmail({
    eventId: event.id,
    registrationId: reg.id,
    type: "event_cancelled",
    mail: {
      to,
      subject: `Cancelled: ${event.title}`,
      html: `<p><strong>${event.title}</strong> was cancelled before its deadline.</p>
<p><strong>You were never charged.</strong></p>
<p><a href="${process.env.APP_URL}">Find another event</a> — or start your own.</p>`,
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

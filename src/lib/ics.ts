import type { Event } from "@/db";

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Minimal RFC 5545 calendar invite for a tipped event (2h duration). */
export function makeIcs(event: Event): string {
  const end = new Date(event.startsAt.getTime() + 2 * 3600 * 1000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tipped//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@tipped`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${event.title.replace(/[\n,;]/g, " ")}`,
    `LOCATION:${`${event.venueName}, ${event.venueAddress}`.replace(/[\n,;]/g, " ")}`,
    `DESCRIPTION:${(event.venueNotes ?? "").replace(/[\n,;]/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

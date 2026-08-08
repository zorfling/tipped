import { Resend } from "resend";
import { and, eq, isNull } from "drizzle-orm";
import { db, emailLog } from "@/db";

const FROM = "Tipped <hello@tipped.example.com>";

interface Mail {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
}

/**
 * Transport-level send. Without RESEND_API_KEY (local dev) the mail is logged
 * to the server console instead so flows remain testable.
 */
export async function sendEmail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.html}`);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: FROM,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    attachments: mail.attachments,
  });
  if (error) throw new Error(`Resend failed: ${error.message}`);
}

/**
 * Idempotent send keyed on (eventId, registrationId, type) via email_log.
 * Safe to call repeatedly — the unique constraint makes exactly-once.
 */
export async function sendEventEmail(opts: {
  eventId: string;
  registrationId?: string;
  type: string;
  mail: Mail;
}): Promise<boolean> {
  const already = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.eventId, opts.eventId),
        opts.registrationId
          ? eq(emailLog.registrationId, opts.registrationId)
          : isNull(emailLog.registrationId),
        eq(emailLog.type, opts.type),
      ),
    );
  if (already.length > 0) return false;

  const [claimed] = await db
    .insert(emailLog)
    .values({
      eventId: opts.eventId,
      registrationId: opts.registrationId ?? null,
      type: opts.type,
    })
    .onConflictDoNothing()
    .returning();
  if (!claimed) return false; // concurrent sender won the claim

  await sendEmail(opts.mail);
  return true;
}

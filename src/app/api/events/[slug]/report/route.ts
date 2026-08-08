import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, registrations, reports, users } from "@/db";
import { getSessionUserId } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getEventBySlug } from "@/lib/events";

const bodySchema = z.object({
  reportedRegistrationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const [reportedReg] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, parsed.data.reportedRegistrationId));
  if (!reportedReg || reportedReg.eventId !== event.id) {
    return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  }

  const [report] = await db
    .insert(reports)
    .values({
      eventId: event.id,
      reporterUserId: userId,
      reportedUserId: reportedReg.userId,
      body: parsed.data.body,
    })
    .returning();

  const admin = process.env.ADMIN_EMAIL;
  if (admin) {
    const [reporter] = await db.select().from(users).where(eq(users.id, userId));
    const [reported] = await db.select().from(users).where(eq(users.id, reportedReg.userId));
    const priorCount = await db
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.reportedUserId, reportedReg.userId));
    await sendEmail({
      to: admin,
      subject: `[Tipped report] ${event.title} — ${reported?.name ?? reported?.email}`,
      html: `<p><strong>Report</strong> for event ${event.title} (${event.slug})</p>
<p>Reported: ${reported?.name ?? ""} &lt;${reported?.email}&gt; (${priorCount.length} report(s) total${priorCount.length >= 2 ? " — FLAGGED, review" : ""})</p>
<p>Reporter: ${reporter?.name ?? ""} &lt;${reporter?.email}&gt;</p>
<blockquote>${parsed.data.body}</blockquote>
<p>Report id: ${report.id}</p>`,
    });
  }

  return NextResponse.json({ ok: true });
}

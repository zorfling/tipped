import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signMagicToken } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const bodySchema = z.object({
  email: z.string().email(),
  next: z.string().startsWith("/").optional(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }
  const { email, next } = parsed.data;
  const token = await signMagicToken(email.trim().toLowerCase());
  const url = new URL("/api/auth/callback", process.env.APP_URL);
  url.searchParams.set("token", token);
  if (next) url.searchParams.set("next", next);

  await sendEmail({
    to: email,
    subject: "Your Tipped sign-in link",
    html: `<p>Tap to sign in — this link works for 15 minutes.</p>
<p><a href="${url.toString()}">Sign in to Tipped</a></p>
<p>If you didn't request this, ignore it.</p>`,
  });

  return NextResponse.json({ ok: true });
}

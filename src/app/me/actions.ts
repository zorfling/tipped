"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth";
import { sendPromotedEmail } from "@/lib/notifications";
import { cancelRegistration } from "@/lib/registration";

export async function cancelMyRegistration(registrationId: string): Promise<{ error?: string }> {
  const userId = await getSessionUserId();
  if (!userId) return { error: "Not signed in" };

  const result = await cancelRegistration({ userId, registrationId });
  if (!result.ok) return { error: result.error };

  for (const promoted of result.promoted) {
    await sendPromotedEmail(result.event, promoted);
  }
  revalidatePath("/me");
  return {};
}

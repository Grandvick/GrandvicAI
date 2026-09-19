"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/business/notifications";

export async function markNotificationReadAction(id: string): Promise<{ error?: string }> {
  const { supabase } = await requireCurrentUser();

  try {
    await markNotificationRead(supabase, id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to mark notification read." };
  }

  revalidatePath("/notifications");
  return {};
}

export async function markAllNotificationsReadAction(): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    const businessId = await resolveBusinessId(supabase, user);
    await markAllNotificationsRead(supabase, businessId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to mark notifications read." };
  }

  revalidatePath("/notifications");
  return {};
}

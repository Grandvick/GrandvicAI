import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationRow = {
  id: string;
  level: "normal" | "important" | "high_priority" | "critical";
  channel: "dashboard" | "whatsapp" | "email" | "voice";
  title: string;
  body: string | null;
  relatedType: string | null;
  relatedId: string | null;
  isRead: boolean;
  createdAt: string;
};

export async function createNotification(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    level: NotificationRow["level"];
    title: string;
    body?: string;
    relatedType?: string;
    relatedId?: string;
  }
) {
  const { error } = await supabase.from("notifications").insert({
    business_id: params.businessId,
    level: params.level,
    channel: "dashboard", // WhatsApp/email/voice delivery channels arrive in Phases 5/6/10
    title: params.title,
    body: params.body ?? null,
    related_type: params.relatedType ?? null,
    related_id: params.relatedId ?? null,
    sent_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function listNotifications(
  supabase: SupabaseClient,
  businessId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationRow[]> {
  let query = supabase
    .from("notifications")
    .select("id, level, channel, title, body, related_type, related_id, is_read, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.unreadOnly) query = query.eq("is_read", false);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((n) => ({
    id: n.id as string,
    level: n.level as NotificationRow["level"],
    channel: n.channel as NotificationRow["channel"],
    title: n.title as string,
    body: n.body as string | null,
    relatedType: n.related_type as string | null,
    relatedId: n.related_id as string | null,
    isRead: n.is_read as boolean,
    createdAt: n.created_at as string,
  }));
}

export async function countUnreadNotifications(
  supabase: SupabaseClient,
  businessId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("is_read", false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(supabase: SupabaseClient, businessId: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("business_id", businessId)
    .eq("is_read", false);
  if (error) throw error;
}

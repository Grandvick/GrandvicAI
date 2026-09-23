import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-conversation structured event timeline (Phase 4, spec section 20 —
 * mirrors lead-events.ts / application-events.ts exactly, the established
 * pattern in this codebase for "log what happened to this record over
 * time"). Distinct from the flat cross-entity `audit_logs` table and from
 * the raw `conversation_messages` transcript — this is what backs
 * analytics like "how many conversations reached qualification_completed"
 * later (spec section 26), and what the Sales Agent panel's "recent
 * conversation events" list reads from.
 */

export const CONVERSATION_EVENT_TYPES = [
  "intent_detected",
  "qualification_started",
  "qualification_completed",
  "lead_created",
  "lead_updated",
  "opportunity_matched",
  "document_requirement_discussed",
  "application_status_requested",
  "human_handover",
  "ai_resumed",
  "follow_up_required",
] as const;

export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

export type ConversationEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdByName: string | null;
  createdAt: string;
};

export async function logConversationEvent(
  supabase: SupabaseClient,
  params: {
    conversationId: string;
    eventType: ConversationEventType;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  }
) {
  const { error } = await supabase.from("conversation_events").insert({
    conversation_id: params.conversationId,
    event_type: params.eventType,
    payload: params.payload ?? {},
    created_by: params.createdBy ?? null,
  });
  if (error) throw error;
}

export async function listConversationEvents(
  supabase: SupabaseClient,
  conversationId: string,
  opts: { limit?: number } = {}
): Promise<ConversationEvent[]> {
  const { data, error } = await supabase
    .from("conversation_events")
    .select("id, event_type, payload, created_at, profiles:created_by (full_name)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 30);

  if (error) throw error;

  return (data ?? []).map((e) => ({
    id: e.id as string,
    eventType: e.event_type as string,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdByName:
      (e.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
    createdAt: e.created_at as string,
  }));
}

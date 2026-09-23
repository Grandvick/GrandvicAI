import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Layer 1 idempotency (Phase 5F — Phase 5 plan, section F): the FIRST
 * database write attempted for any inbound message, before business
 * resolution, before customer/conversation resolution, before the AI runs
 * at all. Insert-first, catch-the-conflict (mirrors
 * createOrGetWhatsAppConversation's race-handling in conversations.ts) —
 * a unique-violation on `wa_event_id` means Meta has redelivered a message
 * this app has already recorded seeing, and the caller should stop and
 * acknowledge (200) with no further side effects (the plan's "Z2" node).
 *
 * Keyed by each individual message's own id (Meta's `wamid`), the same
 * value conversation_messages.external_id will carry for that message
 * (Layer 2) — Meta's webhook envelope has no separate, independently
 * unique identifier for "this whole POST delivery" to use instead (its
 * `entry[].id` is the WABA id, constant across every delivery for that
 * account, not a per-event id) — see webhook-payload.ts's doc comment for
 * the same "flag for verification against Meta's current docs" caveat.
 * Layers 1 and 2 being keyed identically here is still genuine defense in
 * depth: two independent unique constraints, checked at two different
 * points in the pipeline, so an implementation bug or a partial refactor
 * that skips one check doesn't silently remove idempotency altogether.
 *
 * `payload` is the specific message object (not the whole webhook
 * envelope) — enough to debug/replay a single event without storing
 * unbounded, unrelated data alongside it.
 */
export async function recordWebhookEventOnce(
  supabase: SupabaseClient,
  waEventId: string,
  payload: unknown
): Promise<boolean> {
  const { error } = await supabase.from("whatsapp_webhook_events").insert({
    wa_event_id: waEventId,
    payload: payload ?? {},
    processed_at: new Date().toISOString(),
  });

  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw error;
}

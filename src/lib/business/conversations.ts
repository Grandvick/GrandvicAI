import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "./audit";
import { logConversationEvent } from "./conversation-events";

/**
 * Conversation persistence shared across every channel (spec section 12/54
 * — a unified inbox). `conversations`/`conversation_messages` and their RLS
 * policies (`conversations_rw`, `conversation_messages_rw`) already existed
 * since Phase 0 for a future WhatsApp/website/social inbox (Phase 5+); this
 * is the first writer, added in Phase 3 to persist AI Command Center
 * conversations under `channel = 'dashboard'`, `mode = 'ai'` — the same
 * shape a future WhatsApp conversation will use with `channel = 'whatsapp'`.
 * No new/duplicate conversation table was created (see 0006_ai_core.sql,
 * which only widens the `channel` check constraint to include 'dashboard').
 *
 * Phase 4 adds a second conversation "shape" on the same table:
 * `channel = 'website'` for the AI Sales Agent (tested today from the
 * dashboard's simulator, since there is no real website widget until a
 * later phase — see src/lib/ai/sales/). Same table, same RLS, same message
 * store — only the channel value and the structured state columns
 * (spec section 17, added in 0007_ai_sales_agent.sql) differ.
 */

export type ConversationMessageRow = {
  id: string;
  senderType: "customer" | "ai" | "staff";
  content: string;
  createdAt: string;
};

/** Creates a new dashboard AI conversation thread, owned by the staff member who started it. */
export async function createDashboardConversation(
  supabase: SupabaseClient,
  businessId: string,
  staffProfileId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      business_id: businessId,
      channel: "dashboard",
      mode: "ai",
      status: "open",
      assigned_to: staffProfileId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Confirms a conversation id belongs to this business and is a dashboard
 * thread before reusing it — never trusts a client-supplied id blindly, and
 * relies on RLS underneath regardless (the caller's Supabase client is
 * always the authenticated, RLS-scoped one — see src/lib/ai/context.ts).
 */
export async function getDashboardConversation(
  supabase: SupabaseClient,
  businessId: string,
  conversationId: string
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .eq("channel", "dashboard")
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string } : null;
}

export async function appendConversationMessage(
  supabase: SupabaseClient,
  conversationId: string,
  senderType: ConversationMessageRow["senderType"],
  content: string,
  senderProfileId?: string | null,
  /**
   * externalId/direction (Phase 5A's conversation_messages columns, unused
   * by any writer until Phase 5D): a real channel-delivered message —
   * WhatsApp today — has both. Left undefined by the website/dashboard
   * call sites, which have neither and must not have NULL-vs-omitted
   * behavior change for them (the column stays NULL exactly as before).
   */
  opts: { externalId?: string | null; direction?: "inbound" | "outbound" } = {}
): Promise<void> {
  const { error } = await supabase.from("conversation_messages").insert({
    conversation_id: conversationId,
    sender_type: senderType,
    sender_profile_id: senderProfileId ?? null,
    content,
    ...(opts.externalId !== undefined ? { external_id: opts.externalId } : {}),
    ...(opts.direction !== undefined ? { direction: opts.direction } : {}),
  });
  if (error) throw error;

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/**
 * Layer 2 idempotency for the real WhatsApp webhook (Phase 5F — Phase 5
 * plan, section F): checked BEFORE resolving/creating a conversation for an
 * inbound message, so a message this app has already persisted is never
 * processed a second time even if Layer 1 (whatsapp_webhook_events, see
 * src/lib/channels/whatsapp/webhook-events.ts) was somehow bypassed. Global
 * (not scoped to a conversation or business) because
 * conversation_messages_external_id_idx itself is a global unique partial
 * index (see 0008_whatsapp_channel.sql) — a channel-delivered message id
 * must be unique across the whole table, not just within one thread.
 */
export async function conversationMessageExternalIdExists(
  supabase: SupabaseClient,
  externalId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id")
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function listConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  opts: { limit?: number } = {}
): Promise<ConversationMessageRow[]> {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, sender_type, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    senderType: r.sender_type as ConversationMessageRow["senderType"],
    content: r.content as string,
    createdAt: r.created_at as string,
  }));
}

// -----------------------------------------------------------------------------
// Phase 4 — AI Sales Agent conversation engine
// -----------------------------------------------------------------------------

export type ConversationMode = "ai" | "human" | "paused";

/**
 * The human-takeover hard gate (spec section 16) as a single, shared
 * predicate — extracted in Phase 5C from what was inline logic in
 * src/app/api/ai/sales-agent/route.ts (`before.mode !== "ai"`), so every
 * inbound-message entry point (today: the website/dashboard route; from
 * Phase 5F: the WhatsApp webhook orchestration) calls the exact same check
 * rather than two copies that could quietly drift apart (e.g. one checking
 * `=== "human"` and forgetting "paused"). Pure and synchronous — callers
 * still persist the customer's message regardless of the result (a human
 * must see it either way); this only decides whether the AI provider may
 * be invoked.
 */
export function conversationAcceptsAiReplies(state: Pick<ConversationState, "mode">): boolean {
  return state.mode === "ai";
}

export type ConversationState = {
  id: string;
  businessId: string;
  customerId: string | null;
  channel: string;
  mode: ConversationMode;
  status: string;
  leadId: string | null;
  intent: string | null;
  matchedOpportunityId: string | null;
  qualification: Record<string, unknown>;
  handoverReason: string | null;
  lastMessageAt: string | null;
  createdAt: string;
};

const CONVERSATION_STATE_SELECT =
  "id, business_id, customer_id, channel, mode, status, lead_id, intent, matched_opportunity_id, qualification, handover_reason, last_message_at, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConversationState(row: any): ConversationState {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    channel: row.channel,
    mode: row.mode,
    status: row.status,
    leadId: row.lead_id,
    intent: row.intent,
    matchedOpportunityId: row.matched_opportunity_id,
    qualification: (row.qualification as Record<string, unknown>) ?? {},
    handoverReason: row.handover_reason,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

/**
 * Starts a new AI Sales Agent conversation thread (`channel = 'website'`).
 * There is no real inbound website/WhatsApp channel yet in Phase 4 — this is
 * created by the dashboard's "AI Sales Agent (test)" panel, played by a
 * staff member simulating a customer — but the row shape is exactly what a
 * real website widget will create in a later phase, so nothing here changes
 * when that channel goes live.
 */
export async function createSalesAgentConversation(
  supabase: SupabaseClient,
  businessId: string,
  opts: { customerId?: string | null } = {}
): Promise<string> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      business_id: businessId,
      channel: "website",
      mode: "ai",
      status: "open",
      customer_id: opts.customerId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Same ownership-validation pattern as getDashboardConversation, scoped to `channel = 'website'`. */
export async function getSalesAgentConversation(
  supabase: SupabaseClient,
  businessId: string,
  conversationId: string
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .eq("channel", "website")
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string } : null;
}

export async function getConversationState(
  supabase: SupabaseClient,
  conversationId: string
): Promise<ConversationState | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_STATE_SELECT)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapConversationState(data) : null;
}

/**
 * Applies the allow-listed set of structured-state changes a conversation
 * can undergo (spec section 3/17). `qualification` is shallow-merged into
 * the existing jsonb, never replaced wholesale, so one tool call capturing
 * "destination" doesn't erase "budget" captured earlier. Diffs against the
 * previous row so only real changes are written/logged (mirrors
 * updateLeadPipeline's pattern in leads.ts), and every mode change gets both
 * an audit_logs row and a conversation_events row (`human_handover` /
 * `ai_resumed`) — never silent.
 */
export async function updateConversationState(
  supabase: SupabaseClient,
  conversationId: string,
  actor: { id: string | null; type: "user" | "ai" },
  patch: {
    mode?: ConversationMode;
    intent?: string;
    matchedOpportunityId?: string | null;
    qualification?: Record<string, unknown>;
    handoverReason?: string;
    leadId?: string;
    customerId?: string;
  }
): Promise<ConversationState> {
  const { data: before, error: beforeError } = await supabase
    .from("conversations")
    .select(CONVERSATION_STATE_SELECT)
    .eq("id", conversationId)
    .single();
  if (beforeError) throw beforeError;
  const previous = mapConversationState(before);

  const update: Record<string, unknown> = {};
  if (patch.mode !== undefined && patch.mode !== previous.mode) update.mode = patch.mode;
  if (patch.intent !== undefined && patch.intent !== previous.intent) update.intent = patch.intent;
  if (
    patch.matchedOpportunityId !== undefined &&
    patch.matchedOpportunityId !== previous.matchedOpportunityId
  )
    update.matched_opportunity_id = patch.matchedOpportunityId;
  if (patch.handoverReason !== undefined) update.handover_reason = patch.handoverReason;
  if (patch.leadId !== undefined && patch.leadId !== previous.leadId) update.lead_id = patch.leadId;
  if (patch.customerId !== undefined && patch.customerId !== previous.customerId)
    update.customer_id = patch.customerId;
  if (patch.qualification && Object.keys(patch.qualification).length > 0) {
    update.qualification = { ...previous.qualification, ...patch.qualification };
  }

  if (Object.keys(update).length === 0) return previous;

  const { error } = await supabase.from("conversations").update(update).eq("id", conversationId);
  if (error) throw error;

  await logActivity(supabase, {
    businessId: previous.businessId,
    actorType: actor.type,
    actorId: actor.id,
    action: "conversation.updated",
    objectType: "conversation",
    objectId: conversationId,
    metadata: update,
  });

  if (typeof update.mode === "string" && update.mode !== previous.mode) {
    await logConversationEvent(supabase, {
      conversationId,
      eventType: update.mode === "ai" ? "ai_resumed" : "human_handover",
      payload: { from: previous.mode, to: update.mode, reason: patch.handoverReason ?? null },
      createdBy: actor.type === "user" ? actor.id : null,
    });
  }

  return { ...previous, ...mapPatchToState(update) };
}

// -----------------------------------------------------------------------------
// Phase 5D — WhatsApp conversation thread resolution
// -----------------------------------------------------------------------------

/**
 * Finds the existing WhatsApp conversation thread for a given business +
 * phone number, or creates one. Mirrors createSalesAgentConversation's row
 * shape (`mode: 'ai'`, `status: 'open'`) but keyed by `channelThreadKey`
 * (the normalized phone number — see normalizePhone in customers.ts)
 * instead of a client-supplied conversationId: an inbound WhatsApp message
 * carries a phone number, not a conversation id, and the *same* number must
 * always resolve to the *same* thread so a customer's message history stays
 * in one place (0008_whatsapp_channel.sql's
 * `conversations_business_channel_thread_key_idx` is what makes that
 * atomic/enforced at the database level, not just a convention here).
 *
 * Select-first-then-insert, with a fallback re-select on a unique-constraint
 * violation (Postgres error code 23505): two near-simultaneous webhook
 * deliveries for a brand-new thread could both miss the initial select and
 * both attempt insert — exactly one insert wins, and the loser re-selects
 * rather than erroring, since "the conversation already exists" is the
 * expected/correct outcome here, not a real failure the caller should see.
 */
export async function createOrGetWhatsAppConversation(
  supabase: SupabaseClient,
  businessId: string,
  channelThreadKey: string,
  opts: { customerId?: string | null } = {}
): Promise<string> {
  const existing = await selectWhatsAppConversationId(supabase, businessId, channelThreadKey);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      business_id: businessId,
      channel: "whatsapp",
      channel_thread_key: channelThreadKey,
      mode: "ai",
      status: "open",
      customer_id: opts.customerId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const found = await selectWhatsAppConversationId(supabase, businessId, channelThreadKey);
      if (found) return found;
    }
    throw error;
  }

  return data.id as string;
}

async function selectWhatsAppConversationId(
  supabase: SupabaseClient,
  businessId: string,
  channelThreadKey: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("business_id", businessId)
    .eq("channel", "whatsapp")
    .eq("channel_thread_key", channelThreadKey)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.id as string) : null;
}

function mapPatchToState(update: Record<string, unknown>): Partial<ConversationState> {
  const out: Partial<ConversationState> = {};
  if ("mode" in update) out.mode = update.mode as ConversationMode;
  if ("intent" in update) out.intent = update.intent as string;
  if ("matched_opportunity_id" in update) out.matchedOpportunityId = update.matched_opportunity_id as string | null;
  if ("handover_reason" in update) out.handoverReason = update.handover_reason as string;
  if ("lead_id" in update) out.leadId = update.lead_id as string;
  if ("customer_id" in update) out.customerId = update.customer_id as string;
  if ("qualification" in update) out.qualification = update.qualification as Record<string, unknown>;
  return out;
}

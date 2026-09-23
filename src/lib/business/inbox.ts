import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationMode } from "./conversations";

/**
 * The unified inbox list view's data function (Phase 5E — Phase 5 plan,
 * section G). Deliberately "nothing new architecturally" per the plan: no
 * new table, no new column — this is a read view over `conversations`
 * joined to `customers`/`leads`/`profiles` (the exact embedded-relation
 * `.select()` shape leads.ts's `listLeads`/`LEAD_SELECT` already
 * establishes as this codebase's convention — see `customers:customer_id
 * (full_name, phone)`), plus a second, bounded query over
 * `conversation_messages` to attach each row's most recent message preview
 * (there is no single-query "last row per group" in the PostgREST surface
 * this app uses elsewhere, so this follows the same "fetch broader, refine
 * in application code" precedent as `findCustomerByContact` in
 * customers.ts). Both queries are scoped by RLS (business_id =
 * current_business_id()) the same way every other list function in this
 * codebase already is — no service-role client involved.
 */

export type InboxConversationListItem = {
  id: string;
  businessId: string;
  channel: string;
  mode: ConversationMode;
  status: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  leadId: string | null;
  leadTemperature: string | null;
  leadStage: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageSenderType: "customer" | "ai" | "staff" | null;
  /**
   * A derived proxy, not a stored read-receipt: true when the most recent
   * message in the thread came from the customer, i.e. nobody (AI or
   * staff) has replied since. There is no per-staff-member "read" state in
   * the schema (deliberately not added here — Phase 5E adds no columns),
   * so this is the same "does this need attention" signal the plan's
   * "unread indicator" row field is standing in for. A thread the AI
   * answered instantly reads as NOT needing attention even if no human has
   * looked at it yet — that is the intended behavior for a channel where
   * the AI is expected to respond immediately (spec section 16); it is
   * `mode = 'human'`/`'paused'` combined with this flag that actually
   * signals "a person needs to look at this".
   */
  needsReply: boolean;
  createdAt: string;
};

const INBOX_CONVERSATION_SELECT =
  "id, business_id, channel, mode, status, customer_id, lead_id, assigned_to, last_message_at, created_at, customers:customer_id (full_name, phone), leads:lead_id (temperature, stage), assignee:assigned_to (full_name)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConversationRow(row: any): Omit<InboxConversationListItem, "lastMessagePreview" | "lastMessageSenderType" | "needsReply"> {
  return {
    id: row.id,
    businessId: row.business_id,
    channel: row.channel,
    mode: row.mode,
    status: row.status,
    customerId: row.customer_id,
    customerName: row.customers?.full_name ?? null,
    customerPhone: row.customers?.phone ?? null,
    leadId: row.lead_id,
    leadTemperature: row.leads?.temperature ?? null,
    leadStage: row.leads?.stage ?? null,
    assignedTo: row.assigned_to,
    assignedToName: row.assignee?.full_name ?? null,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

export async function listInboxConversations(
  supabase: SupabaseClient,
  businessId: string,
  filters: { channel?: string; mode?: ConversationMode; assignedTo?: string; needsReplyOnly?: boolean } = {}
): Promise<InboxConversationListItem[]> {
  let query = supabase
    .from("conversations")
    .select(INBOX_CONVERSATION_SELECT)
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.mode) query = query.eq("mode", filters.mode);
  if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);

  const { data, error } = await query;
  if (error) throw error;

  const conversations = (data ?? []).map(mapConversationRow);
  if (conversations.length === 0) return [];

  // Bounded second query: the most recent messages across just these
  // conversations, ordered newest-first. Because the query is ordered
  // globally by created_at desc, the FIRST row this loop sees for a given
  // conversation_id is that conversation's most recent message — no
  // separate per-conversation query needed.
  const ids = conversations.map((c) => c.id);
  const { data: messageRows, error: messagesError } = await supabase
    .from("conversation_messages")
    .select("conversation_id, content, sender_type, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(ids.length * 5 + 20);
  if (messagesError) throw messagesError;

  const latestByConversation = new Map<
    string,
    { content: string; senderType: InboxConversationListItem["lastMessageSenderType"] }
  >();
  for (const row of messageRows ?? []) {
    const conversationId = row.conversation_id as string;
    if (latestByConversation.has(conversationId)) continue;
    latestByConversation.set(conversationId, {
      content: row.content as string,
      senderType: row.sender_type as InboxConversationListItem["lastMessageSenderType"],
    });
  }

  const items: InboxConversationListItem[] = conversations.map((c) => {
    const latest = latestByConversation.get(c.id);
    return {
      ...c,
      lastMessagePreview: latest?.content ?? null,
      lastMessageSenderType: latest?.senderType ?? null,
      needsReply: latest?.senderType === "customer",
    };
  });

  return filters.needsReplyOnly ? items.filter((i) => i.needsReply) : items;
}

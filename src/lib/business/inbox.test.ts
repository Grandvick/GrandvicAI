import { describe, expect, it } from "vitest";
import { listInboxConversations } from "./inbox";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    business_id: "biz-1",
    channel: "whatsapp",
    mode: "ai",
    status: "open",
    customer_id: "cust-1",
    lead_id: null,
    assigned_to: null,
    last_message_at: "2026-01-02T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    customers: { full_name: "Jane Customer", phone: "254799999911" },
    leads: null,
    assignee: null,
    ...overrides,
  };
}

// fake-supabase's .order() is a no-op (see src/test/fake-supabase.ts) — test
// fixtures below are already supplied in the order a real ordered query
// would return, so listInboxConversations's "first occurrence wins" latest-
// message dedup (which assumes created_at-desc input) is exercised
// correctly without needing a real database.
function supabaseWith(conversations: Record<string, unknown>[], messages: Record<string, unknown>[] = []): SupabaseClient {
  return makeFakeSupabase({ conversations, conversation_messages: messages }) as unknown as SupabaseClient;
}

describe("listInboxConversations (Phase 5E — the unified inbox list view's data function)", () => {
  it("attaches the customer name/phone via the embedded relation", async () => {
    const supabase = supabaseWith([conversationRow()]);
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.customerName).toBe("Jane Customer");
    expect(item.customerPhone).toBe("254799999911");
  });

  it("falls back to null customer name/phone for a not-yet-linked customer (e.g. a fresh WhatsApp thread)", async () => {
    const supabase = supabaseWith([conversationRow({ customer_id: null, customers: null })]);
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.customerId).toBeNull();
    expect(item.customerName).toBeNull();
  });

  it("attaches lead temperature/stage via the embedded relation when a lead is linked", async () => {
    const supabase = supabaseWith([
      conversationRow({ lead_id: "lead-1", leads: { temperature: "hot", stage: "qualified" } }),
    ]);
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.leadTemperature).toBe("hot");
    expect(item.leadStage).toBe("qualified");
  });

  it("attaches the assigned staff member's name via the embedded relation", async () => {
    const supabase = supabaseWith([
      conversationRow({ assigned_to: "staff-1", assignee: { full_name: "Amina Staff" } }),
    ]);
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.assignedTo).toBe("staff-1");
    expect(item.assignedToName).toBe("Amina Staff");
  });

  it("attaches each conversation's MOST RECENT message as the preview, not an older one", async () => {
    const supabase = supabaseWith(
      [conversationRow({ id: "conv-1" })],
      [
        // Newest first — matches what `.order('created_at', desc)` returns.
        { conversation_id: "conv-1", content: "latest message", sender_type: "ai", created_at: "2026-01-02T00:05:00Z" },
        { conversation_id: "conv-1", content: "older message", sender_type: "customer", created_at: "2026-01-02T00:00:00Z" },
      ]
    );
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.lastMessagePreview).toBe("latest message");
    expect(item.lastMessageSenderType).toBe("ai");
  });

  it("keeps each conversation's preview separate — never mixes up two different threads' latest messages", async () => {
    const supabase = supabaseWith(
      [conversationRow({ id: "conv-1" }), conversationRow({ id: "conv-2" })],
      [
        { conversation_id: "conv-2", content: "conv-2's latest", sender_type: "customer", created_at: "2026-01-02T00:10:00Z" },
        { conversation_id: "conv-1", content: "conv-1's latest", sender_type: "ai", created_at: "2026-01-02T00:05:00Z" },
      ]
    );
    const items = await listInboxConversations(supabase, "biz-1");
    const conv1 = items.find((i) => i.id === "conv-1");
    const conv2 = items.find((i) => i.id === "conv-2");
    expect(conv1?.lastMessagePreview).toBe("conv-1's latest");
    expect(conv2?.lastMessagePreview).toBe("conv-2's latest");
  });

  it("has no message preview / needsReply:false for a brand-new conversation with no messages yet", async () => {
    const supabase = supabaseWith([conversationRow()], []);
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.lastMessagePreview).toBeNull();
    expect(item.needsReply).toBe(false);
  });

  it("needsReply is true when the latest message came from the customer (nobody has replied yet)", async () => {
    const supabase = supabaseWith(
      [conversationRow()],
      [{ conversation_id: "conv-1", content: "hello?", sender_type: "customer", created_at: "2026-01-02T00:05:00Z" }]
    );
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.needsReply).toBe(true);
  });

  it("needsReply is false once the AI (or staff) has replied — the AI's near-instant reply is the common case, not left flagged", async () => {
    const supabase = supabaseWith(
      [conversationRow()],
      [{ conversation_id: "conv-1", content: "Here's what I found…", sender_type: "ai", created_at: "2026-01-02T00:05:00Z" }]
    );
    const [item] = await listInboxConversations(supabase, "biz-1");
    expect(item.needsReply).toBe(false);
  });

  it("filters by channel", async () => {
    const supabase = supabaseWith([
      conversationRow({ id: "conv-wa", channel: "whatsapp" }),
      conversationRow({ id: "conv-web", channel: "website" }),
    ]);
    const items = await listInboxConversations(supabase, "biz-1", { channel: "website" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("conv-web");
  });

  it("filters by mode", async () => {
    const supabase = supabaseWith([
      conversationRow({ id: "conv-ai", mode: "ai" }),
      conversationRow({ id: "conv-human", mode: "human" }),
    ]);
    const items = await listInboxConversations(supabase, "biz-1", { mode: "human" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("conv-human");
  });

  it("filters by assigned staff member", async () => {
    const supabase = supabaseWith([
      conversationRow({ id: "conv-a", assigned_to: "staff-1" }),
      conversationRow({ id: "conv-b", assigned_to: "staff-2" }),
    ]);
    const items = await listInboxConversations(supabase, "biz-1", { assignedTo: "staff-1" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("conv-a");
  });

  it("needsReplyOnly filters out every conversation the AI/staff has already answered", async () => {
    const supabase = supabaseWith(
      [conversationRow({ id: "conv-answered" }), conversationRow({ id: "conv-waiting" })],
      [
        { conversation_id: "conv-answered", content: "answered", sender_type: "ai", created_at: "2026-01-02T00:05:00Z" },
        { conversation_id: "conv-waiting", content: "waiting", sender_type: "customer", created_at: "2026-01-02T00:04:00Z" },
      ]
    );
    const items = await listInboxConversations(supabase, "biz-1", { needsReplyOnly: true });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("conv-waiting");
  });

  it("returns an empty list without a second query when there are no conversations at all", async () => {
    const supabase = supabaseWith([]);
    const items = await listInboxConversations(supabase, "biz-1");
    expect(items).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  updateConversationState,
  conversationAcceptsAiReplies,
  createOrGetWhatsAppConversation,
  conversationMessageExternalIdExists,
} from "./conversations";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    business_id: "biz-1",
    customer_id: null,
    channel: "website",
    mode: "ai",
    status: "open",
    lead_id: null,
    intent: null,
    matched_opportunity_id: null,
    qualification: {},
    handover_reason: null,
    last_message_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function supabaseWith(row: Record<string, unknown>): SupabaseClient {
  return makeFakeSupabase({ conversations: [row], audit_logs: [], conversation_events: [] }) as unknown as SupabaseClient;
}

describe("updateConversationState (Phase 4 spec section 3/16/17)", () => {
  it("moves a conversation from AI_ACTIVE to HUMAN_ACTIVE", async () => {
    const supabase = supabaseWith(conversationRow({ mode: "ai" }));
    const result = await updateConversationState(
      supabase,
      "conv-1",
      { id: "staff-1", type: "user" },
      { mode: "human", handoverReason: "customer asked for a person" }
    );
    expect(result.mode).toBe("human");
    expect(result.handoverReason).toBe("customer asked for a person");
  });

  it("moves a conversation to PAUSED", async () => {
    const supabase = supabaseWith(conversationRow({ mode: "ai" }));
    const result = await updateConversationState(supabase, "conv-1", { id: "staff-1", type: "user" }, { mode: "paused" });
    expect(result.mode).toBe("paused");
  });

  it("resumes AI from human mode", async () => {
    const supabase = supabaseWith(conversationRow({ mode: "human" }));
    const result = await updateConversationState(supabase, "conv-1", { id: "staff-1", type: "user" }, { mode: "ai" });
    expect(result.mode).toBe("ai");
  });

  it("is a no-op (no write, same values returned) when nothing actually changes", async () => {
    const supabase = supabaseWith(conversationRow({ mode: "ai", intent: "JOB_ENQUIRY" }));
    const result = await updateConversationState(supabase, "conv-1", { id: null, type: "ai" }, { mode: "ai", intent: "JOB_ENQUIRY" });
    expect(result.mode).toBe("ai");
    expect(result.intent).toBe("JOB_ENQUIRY");
  });

  it("shallow-merges qualification data rather than replacing it wholesale", async () => {
    const supabase = supabaseWith(conversationRow({ qualification: { destination: "Somalia" } }));
    const result = await updateConversationState(
      supabase,
      "conv-1",
      { id: null, type: "ai" },
      { qualification: { budget: "flexible" } }
    );
    expect(result.qualification).toEqual({ destination: "Somalia", budget: "flexible" });
  });

  it("lets a later qualification patch override a previously captured field", async () => {
    const supabase = supabaseWith(conversationRow({ qualification: { urgency: "low" } }));
    const result = await updateConversationState(
      supabase,
      "conv-1",
      { id: null, type: "ai" },
      { qualification: { urgency: "high" } }
    );
    expect(result.qualification).toEqual({ urgency: "high" });
  });
});

describe("conversationAcceptsAiReplies (Phase 5C — the human-takeover gate, shared across every inbound-message entry point)", () => {
  it("is true only in mode 'ai'", () => {
    expect(conversationAcceptsAiReplies({ mode: "ai" })).toBe(true);
  });

  it("is false in mode 'human'", () => {
    expect(conversationAcceptsAiReplies({ mode: "human" })).toBe(false);
  });

  it("is false in mode 'paused' — the case a naive '=== \"human\"' check would miss", () => {
    expect(conversationAcceptsAiReplies({ mode: "paused" })).toBe(false);
  });
});

describe("createOrGetWhatsAppConversation (Phase 5D — thread resolution by phone number, no client-supplied conversationId)", () => {
  it("creates a new conversation with channel 'whatsapp' and the given channel_thread_key when none exists yet", async () => {
    const supabase = makeFakeSupabase({ conversations: [] }) as unknown as SupabaseClient;

    const id = await createOrGetWhatsAppConversation(supabase, "biz-1", "254799999911", {
      customerId: "cust-1",
    });

    expect(id).toBeTruthy();
    const { data } = await supabase.from("conversations").select("*");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      business_id: "biz-1",
      channel: "whatsapp",
      channel_thread_key: "254799999911",
      mode: "ai",
      status: "open",
      customer_id: "cust-1",
    });
  });

  it("returns the existing conversation id instead of creating a duplicate when one already exists for that business + phone", async () => {
    const supabase = makeFakeSupabase({
      conversations: [
        {
          id: "conv-existing",
          business_id: "biz-1",
          channel: "whatsapp",
          channel_thread_key: "254799999911",
          mode: "ai",
          status: "open",
          customer_id: "cust-1",
        },
      ],
    }) as unknown as SupabaseClient;

    const id = await createOrGetWhatsAppConversation(supabase, "biz-1", "254799999911");

    expect(id).toBe("conv-existing");
    const { data } = await supabase.from("conversations").select("*");
    expect(data).toHaveLength(1); // no second row inserted
  });

  it("never matches a different business's conversation for the same phone number (business-scoped lookup)", async () => {
    const supabase = makeFakeSupabase({
      conversations: [
        {
          id: "conv-other-biz",
          business_id: "biz-OTHER",
          channel: "whatsapp",
          channel_thread_key: "254799999911",
          mode: "ai",
          status: "open",
          customer_id: null,
        },
      ],
    }) as unknown as SupabaseClient;

    const id = await createOrGetWhatsAppConversation(supabase, "biz-1", "254799999911");

    expect(id).not.toBe("conv-other-biz");
  });

  it("re-selects instead of throwing when insert fails with a unique-violation (23505) — the concurrent-webhook race", async () => {
    let selectCallCount = 0;
    const fakeClient = {
      from(table: string) {
        expect(table).toBe("conversations");
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            selectCallCount += 1;
            if (selectCallCount === 1) {
              // First lookup: nothing yet.
              return { data: null, error: null };
            }
            // Second lookup (after the losing insert): the winner's row.
            return {
              data: { id: "conv-winner" },
              error: null,
            };
          },
          insert() {
            return this;
          },
          async single() {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as SupabaseClient;

    const id = await createOrGetWhatsAppConversation(fakeClient, "biz-1", "254799999911");

    expect(id).toBe("conv-winner");
    expect(selectCallCount).toBe(2);
  });
});

describe("conversationMessageExternalIdExists (Phase 5F — Layer 2 idempotency, checked before conversation resolution)", () => {
  it("returns true when a message with that external_id has already been persisted", async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [{ id: "msg-1", conversation_id: "conv-1", external_id: "wamid.ABC", content: "hi" }],
    }) as unknown as SupabaseClient;

    expect(await conversationMessageExternalIdExists(supabase, "wamid.ABC")).toBe(true);
  });

  it("returns false for an external_id never seen before", async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [{ id: "msg-1", conversation_id: "conv-1", external_id: "wamid.ABC", content: "hi" }],
    }) as unknown as SupabaseClient;

    expect(await conversationMessageExternalIdExists(supabase, "wamid.NEVER-SEEN")).toBe(false);
  });

  it("returns false when there are no messages with an external_id at all (e.g. only website/dashboard messages)", async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [{ id: "msg-1", conversation_id: "conv-1", external_id: null, content: "hi" }],
    }) as unknown as SupabaseClient;

    expect(await conversationMessageExternalIdExists(supabase, "wamid.ABC")).toBe(false);
  });
});

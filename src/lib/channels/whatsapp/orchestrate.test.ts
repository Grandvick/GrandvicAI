import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors src/app/api/ai/sales-agent/route.test.ts's mocking pattern closely
// (Phase 5D deliberately reuses the same engine) — one hoisted mock per
// dependency, real implementations only where the extraction itself is
// under test (conversationAcceptsAiReplies).

const toolContextHoisted = vi.hoisted(() => ({ supabase: { marker: "system-supabase" } }));
const toSystemToolContext = vi.fn();
vi.mock("@/lib/ai/context", () => ({
  toSystemToolContext: (...args: unknown[]) => toSystemToolContext(...args),
}));

vi.mock("@/lib/ai/provider", () => ({
  getAiProvider: () => ({ name: "mock", chat: vi.fn() }),
}));

const runAiChat = vi.fn();
vi.mock("@/lib/ai/core", () => ({
  runAiChat: (...args: unknown[]) => runAiChat(...args),
}));

const logAiRun = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ai/logging", () => ({
  logAiRun: (...args: unknown[]) => logAiRun(...args),
  summarizeToolCalls: (calls: { name: string; error?: string; result?: unknown }[]) =>
    calls.map((c) => ({ name: c.name, ok: !c.error })),
}));

const createNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/business/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

const findCustomerByContact = vi.fn();
const createCustomer = vi.fn();
const getCustomer = vi.fn().mockResolvedValue({ fullName: "Jane Customer" });
vi.mock("@/lib/business/customers", () => ({
  findCustomerByContact: (...args: unknown[]) => findCustomerByContact(...args),
  createCustomer: (...args: unknown[]) => createCustomer(...args),
  getCustomer: (...args: unknown[]) => getCustomer(...args),
  normalizePhone: (phone: string) => phone.trim().replace(/[^\d]/g, ""),
}));

const conversationsHoisted = vi.hoisted(() => ({
  state: {
    id: "conv-1",
    businessId: "biz-1",
    customerId: "cust-1",
    channel: "whatsapp",
    mode: "ai" as "ai" | "human" | "paused",
    status: "open",
    leadId: null,
    intent: null,
    matchedOpportunityId: null,
    qualification: {},
    handoverReason: null,
    lastMessageAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
}));

const createOrGetWhatsAppConversation = vi.fn().mockResolvedValue("conv-1");
const appendConversationMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/business/conversations", () => ({
  createOrGetWhatsAppConversation: (...args: unknown[]) => createOrGetWhatsAppConversation(...args),
  getConversationState: vi.fn(() => Promise.resolve({ ...conversationsHoisted.state })),
  listConversationMessages: vi.fn().mockResolvedValue([]),
  appendConversationMessage: (...args: unknown[]) => appendConversationMessage(...args),
  // Real implementation, not a stub — same rule as route.test.ts: the
  // human-takeover gate under test must be the actual Phase 5C extraction.
  conversationAcceptsAiReplies: (state: { mode: string }) => state.mode === "ai",
}));

vi.mock("@/lib/business/conversation-events", () => ({
  listConversationEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/business/conversation-public-state", () => ({
  buildConversationPublicState: vi.fn(async (_supabase: unknown, state: { id: string }) => ({
    id: state.id,
    mode: "ai",
    intent: null,
    leadId: null,
    leadTemperature: null,
    leadScore: null,
    leadStage: null,
    matchedOpportunityId: null,
    matchedOpportunityTitle: null,
    qualification: {},
    handoverReason: null,
  })),
}));

const sendText = vi.fn();
const getWhatsAppProvider = vi.fn(() => ({ name: "whatsapp-mock", sendText, sendTemplate: vi.fn(), sendMedia: vi.fn(), sendDocument: vi.fn() }));
vi.mock("./provider", () => ({
  getWhatsAppProvider: () => getWhatsAppProvider(),
}));

describe("orchestrateInboundWhatsAppMessage (Phase 5D — the channel orchestration layer)", () => {
  beforeEach(() => {
    conversationsHoisted.state.mode = "ai";
    toSystemToolContext.mockReset();
    toSystemToolContext.mockResolvedValue({
      supabase: toolContextHoisted.supabase,
      userId: null,
      roleKey: "system",
      isOwner: false,
      businessId: "biz-1",
      businessName: "Grandvic Tours & Travel",
      now: new Date("2026-01-01T00:00:00Z"),
      conversationId: null,
    });
    findCustomerByContact.mockReset();
    findCustomerByContact.mockResolvedValue([{ id: "cust-1" }]);
    createCustomer.mockReset();
    runAiChat.mockReset();
    logAiRun.mockClear();
    createNotification.mockClear();
    createOrGetWhatsAppConversation.mockClear();
    createOrGetWhatsAppConversation.mockResolvedValue("conv-1");
    appendConversationMessage.mockClear();
    sendText.mockReset();
    sendText.mockResolvedValue({ externalId: "mock-wamid-1", status: "sent" });
    getWhatsAppProvider.mockClear();
  });

  it("reuses an existing customer found by phone rather than creating a duplicate", async () => {
    runAiChat.mockResolvedValue({ reply: "Hi there!", toolCalls: [], model: "mock-dev", usage: { inputTokens: 1, outputTokens: 1 } });
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    const result = await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "+254 799 999 911", text: "hi" });

    expect(createCustomer).not.toHaveBeenCalled();
    expect(createOrGetWhatsAppConversation).toHaveBeenCalledWith(
      toolContextHoisted.supabase,
      "biz-1",
      "254799999911",
      { customerId: "cust-1" }
    );
    expect(result.ok).toBe(true);
  });

  it("creates a new customer when no existing one matches the phone number", async () => {
    findCustomerByContact.mockResolvedValue([]);
    createCustomer.mockResolvedValue("cust-new");
    runAiChat.mockResolvedValue({ reply: "Hi there!", toolCalls: [], model: "mock-dev", usage: { inputTokens: 1, outputTokens: 1 } });
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "254799999911", text: "hi" });

    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(createOrGetWhatsAppConversation).toHaveBeenCalledWith(
      toolContextHoisted.supabase,
      "biz-1",
      "254799999911",
      { customerId: "cust-new" }
    );
  });

  it("hard-gates on human takeover — never calls the AI provider or sends a WhatsApp reply once mode is 'human'", async () => {
    conversationsHoisted.state.mode = "human";
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    const result = await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "254799999911", text: "still waiting" });

    expect(runAiChat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok && !result.aiResponded) {
      expect(result.reason).toBe("human");
    } else {
      throw new Error("expected aiResponded: false");
    }
  });

  it("hard-gates on paused mode the same way", async () => {
    conversationsHoisted.state.mode = "paused";
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    const result = await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "254799999911", text: "hello?" });

    expect(runAiChat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    if (result.ok && !result.aiResponded) {
      expect(result.reason).toBe("paused");
    } else {
      throw new Error("expected aiResponded: false");
    }
  });

  it("runs the sales-agent pipeline, persists both messages, and sends the reply via the WhatsApp provider when mode is 'ai'", async () => {
    runAiChat.mockResolvedValue({
      reply: "We have an open physiotherapy role in Somalia — want the details?",
      toolCalls: [{ name: "get_open_jobs", arguments: {}, result: [] }],
      model: "gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    const result = await orchestrateInboundWhatsAppMessage({
      businessId: "biz-1",
      fromPhone: "254799999911",
      text: "I'm a physiotherapist interested in Somalia.",
      externalId: "wamid.abc123",
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.aiResponded) {
      expect(result.reply).toMatch(/physiotherapy/);
      expect(result.conversationId).toBe("conv-1");
      expect(result.send).toEqual({ externalId: "mock-wamid-1", status: "sent" });
    } else {
      throw new Error("expected aiResponded: true");
    }

    // Inbound message persisted with direction + the channel's external id.
    expect(appendConversationMessage).toHaveBeenCalledWith(
      toolContextHoisted.supabase,
      "conv-1",
      "customer",
      "I'm a physiotherapist interested in Somalia.",
      null,
      { externalId: "wamid.abc123", direction: "inbound" }
    );
    // Outbound AI reply persisted too.
    expect(appendConversationMessage).toHaveBeenCalledWith(
      toolContextHoisted.supabase,
      "conv-1",
      "ai",
      "We have an open physiotherapy role in Somalia — want the details?",
      null,
      { direction: "outbound" }
    );

    expect(sendText).toHaveBeenCalledWith({
      to: "254799999911",
      body: "We have an open physiotherapy role in Somalia — want the details?",
    });

    expect(logAiRun).toHaveBeenCalledTimes(1);
    expect(logAiRun.mock.calls[0][1]).toMatchObject({ status: "success", runType: "sales_agent", userId: null });
  });

  it("notifies the owner when a tool call produces a hot lead, same as the website channel", async () => {
    runAiChat.mockResolvedValue({
      reply: "Great, I've logged your interest.",
      toolCalls: [{ name: "create_lead", arguments: {}, result: { leadId: "lead-1", temperature: "hot" } }],
      model: "gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "254799999911", text: "Yes please sign me up!" });

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][1]).toMatchObject({ relatedType: "lead", relatedId: "lead-1" });
  });

  it("returns ok:false with a safe error (never throws) when the AI pipeline fails", async () => {
    runAiChat.mockRejectedValue(new Error("boom — some internal detail"));
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    const result = await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "254799999911", text: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/boom/);
      expect(result.conversationId).toBe("conv-1");
    }
    expect(sendText).not.toHaveBeenCalled();
  });

  it("returns ok:false (but keeps the already-persisted reply/notifications) when the WhatsApp send itself fails", async () => {
    runAiChat.mockResolvedValue({ reply: "ok", toolCalls: [], model: "mock-dev", usage: { inputTokens: 1, outputTokens: 1 } });
    sendText.mockRejectedValue(new Error("Graph API 500"));
    const { orchestrateInboundWhatsAppMessage } = await import("./orchestrate");

    const result = await orchestrateInboundWhatsAppMessage({ businessId: "biz-1", fromPhone: "254799999911", text: "hi" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/Graph API/);
    }
    // The AI's reply was still persisted and logged even though the send failed.
    expect(appendConversationMessage).toHaveBeenCalledWith(
      toolContextHoisted.supabase,
      "conv-1",
      "ai",
      "ok",
      null,
      { direction: "outbound" }
    );
    expect(logAiRun).toHaveBeenCalledTimes(1);
  });
});

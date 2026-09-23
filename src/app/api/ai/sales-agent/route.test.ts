import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRateLimitStateForTests } from "@/lib/ai/rate-limit";
import { AiAuthError, AiProviderError } from "@/lib/ai/errors";

const hoisted = vi.hoisted(() => ({
  hasOpenAI: true,
  hasAiProvider: true,
}));

vi.mock("@/lib/config", () => ({
  env: {
    get hasOpenAI() {
      return hoisted.hasOpenAI;
    },
    get hasAiProvider() {
      return hoisted.hasAiProvider;
    },
  },
  aiModelConfig: { default: "gpt-4o-mini", fast: "gpt-4o-mini", advanced: "gpt-4o" },
}));

const resolveAiRequestContext = vi.fn();
vi.mock("@/lib/ai/context", () => ({
  resolveAiRequestContext: (...args: unknown[]) => resolveAiRequestContext(...args),
  toToolContext: (ctx: unknown, conversationId: string | null) => ({ ...(ctx as object), conversationId }),
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

vi.mock("@/lib/business/customers", () => ({
  getCustomer: vi.fn().mockResolvedValue({ fullName: "Jane Customer" }),
}));

const conversationsHoisted = vi.hoisted(() => ({
  state: {
    id: "conv-1",
    businessId: "biz-1",
    customerId: null,
    channel: "website",
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

vi.mock("@/lib/business/conversations", () => ({
  createSalesAgentConversation: vi.fn().mockResolvedValue("conv-1"),
  getSalesAgentConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationState: vi.fn(() => Promise.resolve({ ...conversationsHoisted.state })),
  listConversationMessages: vi.fn().mockResolvedValue([]),
  appendConversationMessage: vi.fn().mockResolvedValue(undefined),
  // Real implementation, not a stub — this is the Phase 5C gate extracted
  // from route.ts itself, so the route's behavior under test is exactly
  // what it will be at runtime, not a mocked-away tautology.
  conversationAcceptsAiReplies: (state: { mode: string }) => state.mode === "ai",
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/ai/sales-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeContext() {
  return {
    supabase: {},
    user: { userId: "user-1", isOwner: true, roleKey: "owner" },
    businessId: "biz-1",
    businessName: "Grandvic Tours & Travel",
    now: new Date(),
  };
}

describe("POST /api/ai/sales-agent — the AI Sales Agent conversation engine (spec section 2/16/21)", () => {
  beforeEach(() => {
    hoisted.hasOpenAI = true;
    hoisted.hasAiProvider = true;
    conversationsHoisted.state.mode = "ai";
    resolveAiRequestContext.mockReset();
    runAiChat.mockReset();
    logAiRun.mockClear();
    createNotification.mockClear();
    _resetRateLimitStateForTests();
    delete process.env.AI_RATE_LIMIT_PER_MINUTE;
  });

  it("returns 503 without leaking internals when no provider is configured at all", async () => {
    hoisted.hasOpenAI = false;
    hoisted.hasAiProvider = false;
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(503);
    expect(resolveAiRequestContext).not.toHaveBeenCalled();
  });

  it("does NOT 503 when only AI_PROVIDER=mock is set, even without an OpenAI key (Phase 4 dev/test mode)", async () => {
    hoisted.hasOpenAI = false;
    hoisted.hasAiProvider = true;
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockResolvedValue({ reply: "ok", toolCalls: [], model: "mock-dev", usage: { inputTokens: 1, outputTokens: 1 } });
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    expect(resolveAiRequestContext).toHaveBeenCalled();
  });

  it("returns 401 when there is no authenticated session", async () => {
    resolveAiRequestContext.mockRejectedValue(new AiAuthError());
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed request body with 400, never reaching the provider", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "" }));
    expect(res.status).toBe(400);
    expect(runAiChat).not.toHaveBeenCalled();
  });

  it("hard-gates on human takeover — never calls the AI provider once mode is 'human'", async () => {
    conversationsHoisted.state.mode = "human";
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "still waiting on my documents" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiResponded).toBe(false);
    expect(body.reason).toBe("human");
    expect(runAiChat).not.toHaveBeenCalled();
  });

  it("hard-gates on paused mode the same way", async () => {
    conversationsHoisted.state.mode = "paused";
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hello?" }));
    const body = await res.json();
    expect(body.aiResponded).toBe(false);
    expect(body.reason).toBe("paused");
    expect(runAiChat).not.toHaveBeenCalled();
  });

  it("runs the sales-agent pipeline and returns the reply when mode is 'ai'", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockResolvedValue({
      reply: "We have an open physiotherapy role in Somalia — want the details?",
      toolCalls: [{ name: "get_open_jobs", arguments: {}, result: [] }],
      model: "gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "I'm a physiotherapist interested in Somalia." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiResponded).toBe(true);
    expect(body.reply).toMatch(/physiotherapy/);
    expect(body.conversationId).toBe("conv-1");

    expect(logAiRun).toHaveBeenCalledTimes(1);
    expect(logAiRun.mock.calls[0][1]).toMatchObject({ status: "success", runType: "sales_agent" });
  });

  it("notifies the owner when a tool call produces a hot lead", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockResolvedValue({
      reply: "Great, I've logged your interest.",
      toolCalls: [{ name: "create_lead", arguments: {}, result: { leadId: "lead-1", temperature: "hot" } }],
      model: "gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const { POST } = await import("./route");

    await POST(jsonRequest({ message: "Yes please sign me up right away!" }));
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][1]).toMatchObject({ relatedType: "lead", relatedId: "lead-1" });
  });

  it("returns a safe error and still logs the run when the provider/core pipeline fails", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockRejectedValue(new AiProviderError("The AI provider is having issues right now. Please try again shortly."));
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/provider is having issues/i);
    expect(body.error).not.toMatch(/at Object|node_modules|stack/i);

    expect(logAiRun).toHaveBeenCalledTimes(1);
    expect(logAiRun.mock.calls[0][1]).toMatchObject({ status: "error" });
  });

  it("enforces its own per-user rate limit, independent of the internal Command Centre's", async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "1";
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockResolvedValue({ reply: "ok", toolCalls: [], model: "gpt-4o-mini", usage: { inputTokens: 1, outputTokens: 1 } });
    const { POST } = await import("./route");

    const first = await POST(jsonRequest({ message: "one" }));
    expect(first.status).toBe(200);

    const second = await POST(jsonRequest({ message: "two" }));
    expect(second.status).toBe(429);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRateLimitStateForTests } from "@/lib/ai/rate-limit";
import { AiAuthError, AiBusinessContextError, AiProviderError } from "@/lib/ai/errors";

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
  toToolContext: (ctx: unknown) => ({ ...(ctx as object), toolContext: true }),
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
  summarizeToolCalls: (calls: { name: string; error?: string }[]) =>
    calls.map((c) => ({ name: c.name, ok: !c.error })),
}));

vi.mock("@/lib/business/conversations", () => ({
  createDashboardConversation: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
  getDashboardConversation: vi.fn().mockResolvedValue(null),
  appendConversationMessage: vi.fn().mockResolvedValue(undefined),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/ai/chat", {
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

describe("POST /api/ai/chat — server-side AI endpoint (spec section 8/19/20)", () => {
  beforeEach(() => {
    hoisted.hasOpenAI = true;
    hoisted.hasAiProvider = true;
    resolveAiRequestContext.mockReset();
    runAiChat.mockReset();
    logAiRun.mockClear();
    _resetRateLimitStateForTests();
    delete process.env.AI_RATE_LIMIT_PER_MINUTE;
  });

  it("returns 503 without leaking internals when no provider is configured at all", async () => {
    hoisted.hasOpenAI = false;
    hoisted.hasAiProvider = false;
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured|OPENAI_API_KEY/i);
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

  it("returns 401 when there is no authenticated session (spec section 20 item 1)", async () => {
    resolveAiRequestContext.mockRejectedValue(new AiAuthError());
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/signed in/i);
  });

  it("returns a clear error when business context can't be resolved, without guessing one", async () => {
    resolveAiRequestContext.mockRejectedValue(new AiBusinessContextError("No business exists yet. Create one first (see Settings)."));
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/no business exists yet/i);
  });

  it("rejects a malformed request body with 400, never reaching the provider", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "" }));
    expect(res.status).toBe(400);
    expect(runAiChat).not.toHaveBeenCalled();
  });

  it("runs the chat pipeline and returns the reply + tool call summary + conversation id on success", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockResolvedValue({
      reply: "There are 2 open jobs.",
      toolCalls: [{ name: "get_open_jobs", arguments: {}, result: [] }],
      model: "gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "What jobs are open?" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("There are 2 open jobs.");
    expect(body.toolCalls).toEqual([{ name: "get_open_jobs", ok: true }]);
    expect(body.conversationId).toBeTruthy();

    expect(logAiRun).toHaveBeenCalledTimes(1);
    expect(logAiRun.mock.calls[0][1]).toMatchObject({ status: "success", runType: "command_centre" });
  });

  it("returns a safe error and still logs the run when the provider/core pipeline fails", async () => {
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockRejectedValue(new AiProviderError("The AI provider is having issues right now. Please try again shortly."));
    const { POST } = await import("./route");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/provider is having issues/i);
    expect(body.error).not.toMatch(/at Object|node_modules|stack/i); // no stack trace leak

    expect(logAiRun).toHaveBeenCalledTimes(1);
    expect(logAiRun.mock.calls[0][1]).toMatchObject({ status: "error" });
  });

  it("enforces the per-user rate limit (spec section 16)", async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "1";
    resolveAiRequestContext.mockResolvedValue(fakeContext());
    runAiChat.mockResolvedValue({ reply: "ok", toolCalls: [], model: "gpt-4o-mini", usage: { inputTokens: 1, outputTokens: 1 } });
    const { POST } = await import("./route");

    const first = await POST(jsonRequest({ message: "one" }));
    expect(first.status).toBe(200);

    const second = await POST(jsonRequest({ message: "two" }));
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error).toMatch(/too quickly/i);
  });
});

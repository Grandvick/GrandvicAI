import { describe, expect, it } from "vitest";
import { runAiChat } from "./core";
import { MockAiProvider } from "./provider/mock";
import { AiProviderError } from "./errors";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { AiToolContext } from "./types";

function fakeCtx(): AiToolContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeFakeSupabase({ customers: [] }) as any,
    userId: "user-1",
    roleKey: "owner",
    isOwner: true,
    businessId: "biz-1",
    businessName: "Grandvic Tours & Travel",
    now: new Date("2026-09-20T00:00:00.000Z"),
    conversationId: null,
  };
}

describe("runAiChat — the bounded tool-calling loop (spec section 3/15)", () => {
  it("executes a real registered tool the model asks for, then returns the model's final answer", async () => {
    const provider = new MockAiProvider([
      {
        message: null,
        toolCalls: [{ id: "call_1", name: "search_customers", rawArguments: "{}" }],
        usage: { inputTokens: 50, outputTokens: 10 },
        model: "mock-model",
      },
      {
        message: "You have no customers yet.",
        toolCalls: [],
        usage: { inputTokens: 60, outputTokens: 8 },
        model: "mock-model",
      },
    ]);

    const result = await runAiChat({
      provider,
      toolContext: fakeCtx(),
      systemPrompt: "You are a test assistant.",
      history: [],
      userMessage: "List my customers.",
    });

    expect(result.reply).toBe("You have no customers yet.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("search_customers");
    expect(result.toolCalls[0].error).toBeUndefined();
    expect(result.usage.inputTokens).toBe(110);
    expect(result.usage.outputTokens).toBe(18);

    // The second provider.chat() call must have received the tool result as a "tool" turn.
    expect(provider.receivedCalls).toHaveLength(2);
    const secondCallTurns = provider.receivedCalls[1].turns;
    expect(secondCallTurns.some((t) => t.role === "tool" && t.name === "search_customers")).toBe(true);
  });

  it("records a tool call the model made with a nonexistent tool name as a safe error, without crashing", async () => {
    const provider = new MockAiProvider([
      {
        message: null,
        toolCalls: [{ id: "call_1", name: "delete_customer", rawArguments: "{}" }],
        usage: { inputTokens: 10, outputTokens: 5 },
        model: "mock-model",
      },
      { message: "I can't do that yet.", toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, model: "mock-model" },
    ]);

    const result = await runAiChat({ provider, toolContext: fakeCtx(),
      systemPrompt: "You are a test assistant.", history: [], userMessage: "Delete a customer." });

    expect(result.toolCalls[0].name).toBe("delete_customer");
    expect(result.toolCalls[0].error).toMatch(/unknown tool/i);
    expect(result.reply).toBe("I can't do that yet.");
  });

  it("handles malformed (non-JSON) tool arguments from the model without throwing", async () => {
    const provider = new MockAiProvider([
      {
        message: null,
        toolCalls: [{ id: "call_1", name: "search_customers", rawArguments: "{not valid json" }],
        usage: { inputTokens: 10, outputTokens: 5 },
        model: "mock-model",
      },
      { message: "Sorry, something went wrong.", toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, model: "mock-model" },
    ]);

    const result = await runAiChat({ provider, toolContext: fakeCtx(),
      systemPrompt: "You are a test assistant.", history: [], userMessage: "hi" });
    expect(result.toolCalls[0].error).toMatch(/malformed/i);
  });

  it("terminates after MAX_TOOL_ROUNDTRIPS rather than looping forever if the model keeps calling tools", async () => {
    const infiniteToolCallResult = {
      message: null,
      toolCalls: [{ id: "call_x", name: "get_dashboard_summary", rawArguments: "{}" }],
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "mock-model",
    };
    // Script more rounds than the loop's ceiling — it must still return, not hang.
    const provider = new MockAiProvider(Array(10).fill(infiniteToolCallResult));

    const result = await runAiChat({ provider, toolContext: fakeCtx(),
      systemPrompt: "You are a test assistant.", history: [], userMessage: "loop forever" });

    expect(result.reply).toMatch(/couldn't finish|within this request/i);
    expect(provider.receivedCalls.length).toBeLessThanOrEqual(4);
  });

  it("propagates a provider failure as a safe AiError rather than a raw exception", async () => {
    const failingProvider = {
      name: "mock",
      chat: async () => {
        throw new AiProviderError("The AI provider is having issues right now. Please try again shortly.");
      },
    };

    await expect(
      runAiChat({ provider: failingProvider, toolContext: fakeCtx(),
      systemPrompt: "You are a test assistant.", history: [], userMessage: "hi" })
    ).rejects.toThrow(AiProviderError);
  });

  it("caps conversation history sent to the provider (cost control, spec section 15)", async () => {
    const provider = new MockAiProvider([
      { message: "ok", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: "mock-model" },
    ]);
    const longHistory: { role: "user" | "assistant"; content: string }[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));

    await runAiChat({ provider, toolContext: fakeCtx(),
      systemPrompt: "You are a test assistant.", history: longHistory, userMessage: "latest" });

    const sentTurns = provider.receivedCalls[0].turns;
    // 1 system + at most 12 history + 1 new user message
    expect(sentTurns.length).toBeLessThanOrEqual(14);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConfigError as AiConfigErrorType } from "../errors";

describe("getAiProvider — provider factory (spec section 2/14, Phase 4 AI_PROVIDER switch)", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    vi.resetModules();
  });

  it("throws a safe, user-facing AiConfigError when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.resetModules();
    // Re-imported from the SAME fresh module registry as getAiProvider below
    // (vi.resetModules() gives every import() a new instance) so `instanceof`
    // checks against the class actually thrown line up.
    const { AiConfigError } = await import("../errors");
    const { getAiProvider } = await import("./index");

    expect(() => getAiProvider()).toThrow(AiConfigError);
    try {
      getAiProvider();
    } catch (err) {
      expect((err as AiConfigErrorType).userMessage).toMatch(/not configured|OPENAI_API_KEY/i);
      expect((err as AiConfigErrorType).userMessage).not.toMatch(/sk-/); // never echoes a key
    }
  });

  it("returns a real OpenAI-backed provider when the key is present", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    delete process.env.AI_PROVIDER;
    vi.resetModules();
    const { getAiProvider } = await import("./index");

    const provider = getAiProvider();
    expect(provider.name).toBe("openai");
  });

  it("returns the rule-based dev/test provider when AI_PROVIDER=mock — WITHOUT needing an OpenAI key at all", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PROVIDER = "mock";
    vi.resetModules();
    const { getAiProvider } = await import("./index");

    const provider = getAiProvider();
    expect(provider.name).toBe("mock-dev");
  });

  it("prefers the mock provider over a real key when AI_PROVIDER=mock is explicitly set (an explicit switch, not a fallback)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.AI_PROVIDER = "mock";
    vi.resetModules();
    const { getAiProvider } = await import("./index");

    const provider = getAiProvider();
    expect(provider.name).toBe("mock-dev");
  });

  it("ignores an unrecognized AI_PROVIDER value and falls back to the real provider (never silently mocks a typo)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.AI_PROVIDER = "not-a-real-provider";
    vi.resetModules();
    const { getAiProvider } = await import("./index");

    const provider = getAiProvider();
    expect(provider.name).toBe("openai");
  });

  it("the mock provider never calls the real OpenAI SDK — chat() resolves purely from the given turns/tools", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PROVIDER = "mock";
    vi.resetModules();
    const { getAiProvider } = await import("./index");

    const provider = getAiProvider();
    const result = await provider.chat(
      [
        { role: "system", content: "You are Grandvic AI, the internal business assistant." },
        { role: "user", content: "hello" },
      ],
      []
    );
    expect(result.model).toBe("mock-dev");
    expect(typeof result.message === "string" || result.toolCalls.length > 0).toBe(true);
  });
});

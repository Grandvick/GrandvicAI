import "server-only";
import { AiConfigError } from "../errors";
import { OpenAiProvider } from "./openai";
import { DevRuleBasedProvider } from "./dev-mock";
import { aiModelConfig, aiProviderConfig } from "@/lib/config";
import type { AiProvider } from "../types";

/**
 * Provider factory (spec section 2). The app always goes through this
 * function to get a provider — never `new OpenAiProvider()` directly
 * outside this file — so swapping or adding a provider later is a change
 * in exactly one place, and both AI personas (`/api/ai/chat` and
 * `/api/ai/sales-agent`) automatically pick up whichever provider is
 * selected without either route needing its own switch.
 *
 * Phase 4 adds a single, explicit dev/test switch on top of the Phase 3
 * behavior: `AI_PROVIDER=mock` (see `aiProviderConfig` in src/lib/config.ts)
 * returns `DevRuleBasedProvider` — a deterministic, zero-cost provider that
 * exercises the real tool-calling loop without ever calling OpenAI, for
 * local development/testing without live billing/credits. This is NEVER
 * automatic: a missing/broken OPENAI_API_KEY does not silently fall back to
 * the mock (that would risk masking a real outage in production) — it still
 * throws AiConfigError exactly as before. Only an explicit `AI_PROVIDER=mock`
 * changes what this function returns.
 */
export function getAiProvider(): AiProvider {
  if (aiProviderConfig.kind === "mock") {
    return new DevRuleBasedProvider();
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiConfigError();
  }
  return new OpenAiProvider(apiKey, aiModelConfig.default);
}

import "server-only";
import type { AiProvider, AiProviderChatResult, AiProviderTurn, AiProviderToolSchema } from "../types";

/**
 * A deterministic, zero-cost provider used ONLY by tests (spec section 20:
 * "Tests must NOT require spending real OpenAI API money"). Never used at
 * runtime in the app — src/lib/ai/provider/index.ts's factory always
 * returns the real OpenAiProvider (or throws AiConfigError if unconfigured)
 * so the AI Command Center never silently pretends to answer with fake
 * data; see that file for why.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  private script: AiProviderChatResult[];
  private callIndex = 0;
  public receivedCalls: { turns: AiProviderTurn[]; tools: AiProviderToolSchema[] }[] = [];

  /** `script` is the sequence of results to return, one per `chat()` call (e.g. a tool-call turn, then a final-answer turn). */
  constructor(script: AiProviderChatResult[]) {
    this.script = script;
  }

  async chat(turns: AiProviderTurn[], tools: AiProviderToolSchema[]): Promise<AiProviderChatResult> {
    this.receivedCalls.push({ turns, tools });
    const result = this.script[this.callIndex];
    this.callIndex += 1;
    if (!result) {
      return { message: "(mock provider ran out of scripted responses)", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, model: "mock" };
    }
    return result;
  }
}

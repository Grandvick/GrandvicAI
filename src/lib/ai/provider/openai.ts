import "server-only";
import OpenAI from "openai";
import { AiProviderError } from "../errors";
import type {
  AiProvider,
  AiProviderChatResult,
  AiProviderTurn,
  AiProviderToolSchema,
} from "../types";

/**
 * The only file in the AI Core that imports the OpenAI SDK — everything
 * else (core.ts, tools/*, the API route) talks to the provider-agnostic
 * `AiProvider` interface in src/lib/ai/types.ts, so a second provider could
 * be added later behind the same interface without touching business logic
 * (spec section 2).
 */
export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(turns: AiProviderTurn[], tools: AiProviderToolSchema[]): Promise<AiProviderChatResult> {
    const messages = turns.map(toOpenAiMessage);

    const openAiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: openAiTools.length > 0 ? openAiTools : undefined,
        tool_choice: openAiTools.length > 0 ? "auto" : undefined,
        // Cost control (spec section 15) — a business-assistant reply never
        // needs to be an essay, and this caps runaway cost on a single call.
        max_completion_tokens: 800,
      });
    } catch (err) {
      throw mapOpenAiError(err);
    }

    const choice = completion.choices[0];
    if (!choice) {
      throw new AiProviderError("The AI provider returned an empty response.");
    }

    const toolCalls = (choice.message.tool_calls ?? [])
      .filter((c) => c.type === "function")
      .map((c) => ({
        id: c.id,
        name: c.function.name,
        rawArguments: c.function.arguments,
      }));

    return {
      message: choice.message.content ?? null,
      toolCalls,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? null,
        outputTokens: completion.usage?.completion_tokens ?? null,
      },
      model: completion.model,
    };
  }
}

function toOpenAiMessage(turn: AiProviderTurn): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (turn.role === "system") return { role: "system", content: turn.content };
  if (turn.role === "user") return { role: "user", content: turn.content };
  if (turn.role === "tool") {
    return { role: "tool", tool_call_id: turn.toolCallId, content: turn.content };
  }
  // assistant
  return {
    role: "assistant",
    content: turn.content,
    tool_calls: turn.toolCalls?.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: c.rawArguments },
    })),
  };
}

function mapOpenAiError(err: unknown): AiProviderError {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) {
      return new AiProviderError("The AI provider rejected the configured API key. Check OPENAI_API_KEY.", {
        statusCode: 503,
        cause: err,
      });
    }
    if (err.status === 429) {
      return new AiProviderError("The AI provider is rate-limiting requests right now. Please try again shortly.", {
        statusCode: 429,
        cause: err,
      });
    }
    if (err.status && err.status >= 500) {
      return new AiProviderError("The AI provider is having issues right now. Please try again shortly.", {
        statusCode: 503,
        cause: err,
      });
    }
  }
  return new AiProviderError(undefined, { cause: err });
}

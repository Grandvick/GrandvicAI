import "server-only";
import { getProviderToolSchemas, executeTool } from "./tools/registry";
import { toAiError, AiToolError, AiValidationError } from "./errors";
import type {
  AiChatMessage,
  AiProvider,
  AiProviderTurn,
  AiToolCallRecord,
  AiToolContext,
} from "./types";

/** Hard ceiling on tool round-trips per request (spec section 15 — "do not build expensive autonomous loops"). */
const MAX_TOOL_ROUNDTRIPS = 4;

/** Caps how much conversation history is sent to the provider (spec section 15 — never a huge/unbounded payload). */
const MAX_HISTORY_MESSAGES = 12;

export type RunAiChatParams = {
  provider: AiProvider;
  toolContext: AiToolContext;
  /**
   * The fully-built system prompt for this request. Phase 4 generalized this
   * from an internal call to buildSystemPrompt() so the same bounded loop
   * serves both the internal AI Command Centre (prompts/system.ts) and the
   * AI Sales Agent (prompts/sales-agent.ts) — the loop itself doesn't know
   * or care which persona is talking.
   */
  systemPrompt: string;
  /** Prior turns of this conversation, oldest first — already capped by the caller if very long. */
  history: AiChatMessage[];
  /** The new user message. */
  userMessage: string;
};

export type RunAiChatResult = {
  reply: string;
  toolCalls: AiToolCallRecord[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * The AI request pipeline (spec section 3):
 *   identify intent -> select tool(s) -> execute tool(s) -> return
 *   structured results -> generate natural-language response
 *
 * In practice this is a bounded tool-calling loop: send the conversation +
 * tool schemas to the provider; if it asks to call tools, run them through
 * the registry (which enforces business scope, input validation, and the
 * read-only permission boundary) and feed the results back; repeat up to
 * MAX_TOOL_ROUNDTRIPS times; once the provider returns a plain message
 * instead of tool calls, that's the final reply. AI run logging happens one
 * level up, in the API route, which has the wall-clock timing and can log
 * both success and failure paths uniformly.
 */
export async function runAiChat(params: RunAiChatParams): Promise<RunAiChatResult> {
  const { provider, toolContext, systemPrompt, history, userMessage } = params;

  const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);

  const turns: AiProviderTurn[] = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory.map((m): AiProviderTurn => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    { role: "user", content: userMessage },
  ];

  const toolSchemas = getProviderToolSchemas();
  const allToolCalls: AiToolCallRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDTRIPS; round++) {
    const result = await provider.chat(turns, toolSchemas);
    totalInputTokens += result.usage.inputTokens ?? 0;
    totalOutputTokens += result.usage.outputTokens ?? 0;

    if (result.toolCalls.length === 0) {
      return {
        reply: result.message?.trim() || "I don't have a response for that — could you rephrase?",
        toolCalls: allToolCalls,
        model: result.model,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      };
    }

    // Record the assistant's tool-call turn, then run each tool and record
    // its result as a "tool" turn — the standard function-calling transcript
    // shape every provider that supports tool calling expects.
    turns.push({ role: "assistant", content: result.message, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = call.rawArguments ? JSON.parse(call.rawArguments) : {};
      } catch {
        const record: AiToolCallRecord = { name: call.name, arguments: {}, error: "The model sent malformed arguments (not valid JSON)." };
        allToolCalls.push(record);
        turns.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ error: record.error }) });
        continue;
      }

      try {
        const toolResult = await executeTool(toolContext, call.name, parsedArgs);
        allToolCalls.push({ name: call.name, arguments: parsedArgs as Record<string, unknown>, result: toolResult });
        turns.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: safeJsonStringify(toolResult),
        });
      } catch (err) {
        const aiErr = err instanceof AiToolError || err instanceof AiValidationError ? err : toAiError(err);
        allToolCalls.push({ name: call.name, arguments: parsedArgs as Record<string, unknown>, error: aiErr.userMessage });
        turns.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ error: aiErr.userMessage }) });
      }
    }
  }

  // Ran out of round-trips — terminate safely rather than looping forever
  // (spec section 15/9 — tool calls must terminate).
  return {
    reply: "I gathered some information but couldn't finish forming an answer within this request's limits. Please try a more specific question.",
    toolCalls: allToolCalls,
    model: "unknown",
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    // Cost control: truncate an unexpectedly huge tool result rather than
    // sending it all back to the model.
    return json.length > 12000 ? json.slice(0, 12000) + "...(truncated)" : json;
  } catch {
    return '{"error":"Result could not be serialized."}';
  }
}

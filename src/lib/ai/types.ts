import "server-only";
import type { ZodType } from "zod";

/**
 * Core types for the Grandvic AI Core (Phase 3).
 *
 * These types are deliberately provider-agnostic — nothing here mentions
 * OpenAI. `src/lib/ai/provider/openai.ts` is the only file that imports the
 * OpenAI SDK and translates to/from these shapes, so a second provider could
 * be added later (spec section 2: "a clean provider abstraction") without
 * touching src/lib/ai/core.ts, src/lib/ai/tools/*, or the API route.
 */

export type AiChatRole = "system" | "user" | "assistant";

export type AiChatMessage = {
  role: AiChatRole;
  content: string;
};

/** One business/module-scoped tool call the model made, and what it got back. */
export type AiToolCallRecord = {
  name: string;
  arguments: Record<string, unknown>;
  /** Present when the tool ran successfully. */
  result?: unknown;
  /** Present when the tool call was rejected (bad args, not found, etc). Never a raw stack trace. */
  error?: string;
};

/** What a tool receives at call time — the authenticated request's resolved scope, never raw credentials. */
export type AiToolContext = {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  /**
   * The signed-in staff member driving this request, or null for a
   * system/service actor (Phase 5C — e.g. a future WhatsApp webhook, which
   * has no signed-in user at all). Every write tool that threads this
   * through to a `created_by`/`owner_id` column already stores it in a
   * nullable FK to profiles(id) — see customers.ts/leads.ts/tasks.ts/
   * applications.ts — so null here means "created by the system," not "no
   * value provided."
   */
  userId: string | null;
  roleKey: string;
  isOwner: boolean;
  businessId: string;
  businessName: string;
  now: Date;
  /**
   * The active customer conversation this request is part of, if any
   * (Phase 4). Set by the AI Sales Agent route (src/app/api/ai/sales-agent/
   * route.ts); always null for the internal AI Command Centre, which has no
   * customer-conversation concept for tools to act on. Resolved server-side
   * exactly like businessId — a conversation-scoped tool (add_conversation_
   * event, update_conversation_state) never accepts a conversationId
   * argument from the model, for the same reason no tool accepts businessId
   * from the model (see src/lib/ai/tools/write.ts).
   */
  conversationId: string | null;
};

export type AiToolPermission = "read" | "write";

export type AiToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  /** Zod schema — also converted to JSON Schema for the provider's function-calling contract. */
  inputSchema: ZodType<TInput>;
  /** Phase 3 only ever registers "read" tools — see src/lib/ai/tools/registry.ts. */
  permission: AiToolPermission;
  handler: (ctx: AiToolContext, input: TInput) => Promise<TOutput>;
};

/** Provider-facing tool schema (JSON-Schema function-calling contract), derived from AiToolDefinition. */
export type AiProviderToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** A tool invocation request coming back from the model, before validation. */
export type AiProviderToolCall = {
  id: string;
  name: string;
  rawArguments: string;
};

export type AiProviderChatResult = {
  /** Set when the model produced a final natural-language answer. */
  message: string | null;
  /** Set when the model wants to call one or more tools instead of answering yet. */
  toolCalls: AiProviderToolCall[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  /** The actual model name the provider used to serve this call. */
  model: string;
};

/** A single turn in the provider-facing transcript, including tool round-trips. */
export type AiProviderTurn =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: AiProviderToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface AiProvider {
  readonly name: string;
  chat(turns: AiProviderTurn[], tools: AiProviderToolSchema[]): Promise<AiProviderChatResult>;
}

export type AiRunStatus = "success" | "error" | "blocked";

export type AiChatResponse = {
  reply: string;
  toolCalls: AiToolCallRecord[];
  model: string;
  runId: string | null;
};

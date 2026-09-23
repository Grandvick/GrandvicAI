import "server-only";
import { z } from "zod";
import { READ_ONLY_TOOLS } from "./read-only";
import { WRITE_TOOLS } from "./write";
import { AiToolError, AiValidationError } from "../errors";
import type { AiProviderToolSchema, AiToolContext, AiToolDefinition } from "../types";

/**
 * The tool registry (spec section 4/9). This is the ONLY place tools are
 * registered — the AI provider never sees, and the tool executor never
 * calls, anything not listed here.
 *
 * Phase 3 registered only READ_ONLY_TOOLS. Phase 4 adds WRITE_TOOLS: a
 * small, explicit, individually-schema'd set of create/update tools (spec
 * section 14) — never a generic `update_database` or `execute_sql` tool,
 * and never delete/payment/publish/status-change tools (spec section 15).
 * Both the internal AI Command Centre and the AI Sales Agent share this
 * SAME registry (spec's own "same core can power Dashboard AI, WhatsApp AI,
 * ... without hard-coding any one module" architecture principle) — what
 * differs between them is only the system prompt persona
 * (src/lib/ai/prompts/system.ts vs. prompts/sales-agent.ts) and, for
 * conversation-scoped tools, whether `ctx.conversationId` is set.
 */
const REGISTRY: AiToolDefinition<never, unknown>[] = [...READ_ONLY_TOOLS, ...WRITE_TOOLS];

export function getRegisteredTools(): AiToolDefinition<never, unknown>[] {
  return REGISTRY;
}

export function getToolDefinition(name: string): AiToolDefinition<never, unknown> | undefined {
  return REGISTRY.find((t) => t.name === name);
}

/** Converts every registered tool's Zod input schema into the provider's function-calling JSON Schema contract. */
export function getProviderToolSchemas(): AiProviderToolSchema[] {
  return REGISTRY.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }) as Record<string, unknown>,
  }));
}

/**
 * Validates and runs one tool call. Never throws a raw error outward — every
 * failure path (unknown tool, bad arguments, handler failure) is normalized
 * to an AiToolError with a message safe to show the user or feed back to the
 * model as the tool result.
 */
export async function executeTool(
  ctx: AiToolContext,
  name: string,
  rawArguments: unknown
): Promise<unknown> {
  const tool = getToolDefinition(name);
  if (!tool) {
    throw new AiToolError(name, `Unknown tool "${name}".`);
  }

  const parsed = tool.inputSchema.safeParse(rawArguments ?? {});
  if (!parsed.success) {
    throw new AiValidationError(
      `The "${name}" tool call had invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  return tool.handler(ctx, parsed.data as never);
}

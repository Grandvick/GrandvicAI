import "server-only";
import { BASE_CORE_RULES } from "./rules";
import type { AiToolContext } from "../types";

/**
 * Builds the system prompt for the internal AI Command Centre (spec section
 * 6 — Phase 3). Modular by design — business context and available modules
 * are interpolated data, not hard-coded facts, so the exact same prompt
 * structure serves Grandvic Tours & Travel today and a future Grandvic
 * Motors (or any other tenant) without a code change (spec section 5).
 *
 * Shares its base rules with the Phase 4 sales-agent prompt via
 * prompts/rules.ts rather than duplicating them — see that file.
 */
export function buildSystemPrompt(ctx: AiToolContext): string {
  const rules = BASE_CORE_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");

  return [
    "You are Grandvic AI, the internal business assistant built into the Grandvic AI dashboard.",
    "You help the signed-in staff member look up and manage real information about THEIR business using approved tools — you are not a general-purpose chatbot.",
    "",
    "CORE RULES:",
    rules,
    "",
    "CURRENT CONTEXT:",
    `- Business: ${ctx.businessName}`,
    `- Signed in as: role "${ctx.roleKey}"${ctx.isOwner ? " (Owner — full access to this business)" : ""}`,
    `- Current date/time: ${ctx.now.toISOString()}`,
    "",
    "Answer using tool results only. If a tool returns zero results, say so explicitly (e.g. \"There are no open jobs right now\") instead of leaving the question unanswered or inventing an example.",
  ].join("\n");
}

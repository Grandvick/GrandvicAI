import { z } from "zod";

/**
 * Validates that a string is SHAPED like a UUID — the standard
 * 8-4-4-4-12 hex format Postgres's `uuid` column type itself accepts —
 * WITHOUT also requiring Zod's stricter `.uuid()` check, which additionally
 * demands a valid RFC4122 version nibble (`[1-8]`) and variant nibble
 * (`[89ab]`). Every id field validated with this helper anywhere in the AI
 * layer (here, and in src/lib/ai/tools/{write,read-only}.ts) is a reference
 * to an EXISTING business-scoped row — a customerId/leadId/opportunityId/
 * applicationId/conversationId either echoed back from a prior tool result
 * or (for this file) a dashboard-supplied pre-selection — never a
 * freshly-generated id whose randomness properties matter for security.
 * The actual security boundary for all of these is RLS plus the
 * `ctx.businessId`/`business_id` scoping every business-logic query already
 * applies — never the version bits of the id string itself.
 *
 * This matters because Phase 0's seed.sql demo data (and, going forward,
 * anything a script or a human hand-types rather than lets Postgres
 * generate via `gen_random_uuid()`) uses readable, sequential placeholder
 * ids like `00000000-0000-0000-0000-000000000101` (the seeded
 * "[DEMO] Registered Nurse — Luxembourg" job). These are entirely valid
 * Postgres `uuid` values — Postgres does not check the version/variant
 * nibbles — but Zod's `.uuid()` rejected them with "Invalid UUID",
 * breaking any AI tool call (create_lead, get_job, etc.) that referenced
 * one of these real rows, even though the row and the id were both
 * completely legitimate. `.guid()` is Zod v4's deliberately format-only
 * sibling for exactly this situation: it still rejects anything that
 * isn't UUID-shaped at all (a customer name, a phone number, a job title
 * — never accepted as a substitute for a real id), it just doesn't also
 * enforce a specific UUID sub-version.
 */
export function dbId(message?: string) {
  return z.string().guid(message);
}

/** Validates the /api/ai/chat request body — never trust client input (spec section 33's rule, applied here too). */
export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message can't be empty.").max(4000, "That message is too long."),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      })
    )
    .max(40, "Conversation history is too long.")
    .optional()
    .default([]),
  conversationId: dbId().optional(),
});

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

/**
 * Validates the /api/ai/sales-agent request body (Phase 4). Structurally
 * identical to aiChatRequestSchema (same cost-control bounds — spec section
 * 27) but kept as its own schema since the two request shapes are
 * conceptually different (staff asking a question vs. a simulated customer
 * message) and are very likely to diverge as real channels arrive.
 */
export const salesAgentChatRequestSchema = z.object({
  message: z.string().trim().min(1, "Message can't be empty.").max(4000, "That message is too long."),
  conversationId: dbId().optional(),
  /** Optional: pre-select a known customer for this test conversation (dashboard simulator only). */
  customerId: dbId().optional(),
});

export type SalesAgentChatRequest = z.infer<typeof salesAgentChatRequestSchema>;

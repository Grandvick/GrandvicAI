import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiRunStatus, AiToolCallRecord } from "./types";

export type AiRunLogEntry = {
  businessId: string | null;
  userId: string | null;
  runType: string;
  /** The user's message plus a couple of cheap, non-sensitive shape facts — never the full tool-result payloads (spec section 10/11: avoid storing unnecessary full content). */
  input: { message: string; historyLength: number };
  output: { reply: string; toolCalls: { name: string; ok: boolean }[] };
  model: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  latencyMs: number;
  status: AiRunStatus;
  errorMessage?: string | null;
};

/**
 * Writes one row to `public.ai_runs` (spec section 10) — the table and its
 * RLS policy (`ai_runs_rw`) already existed since Phase 0; this is the
 * first writer. One insert per completed request (the schema has no
 * separate started_at/completed_at columns to update mid-flight — the API
 * route measures latency_ms itself and logs once the whole exchange, tool
 * calls included, has finished). Never throws — a logging failure must
 * never break the chat response the user is waiting on, matching the same
 * fire-and-forget-safe pattern as `logActivity` in src/lib/business/audit.ts.
 */
export async function logAiRun(supabase: SupabaseClient, entry: AiRunLogEntry): Promise<void> {
  try {
    await supabase.from("ai_runs").insert({
      business_id: entry.businessId,
      user_id: entry.userId,
      run_type: entry.runType,
      input: entry.input,
      output: entry.output,
      model: entry.model,
      tokens_input: entry.tokensInput,
      tokens_output: entry.tokensOutput,
      cost_estimate: estimateCostUsd(entry.model, entry.tokensInput, entry.tokensOutput),
      latency_ms: entry.latencyMs,
      status: entry.status,
      error_message: entry.errorMessage ?? null,
    });
  } catch (err) {
    console.error("ai_runs log write failed", entry.runType, err);
  }
}

/** Summarizes tool calls for storage — record which tools ran and whether they succeeded, never the full result payloads. */
export function summarizeToolCalls(calls: AiToolCallRecord[]): { name: string; ok: boolean }[] {
  return calls.map((c) => ({ name: c.name, ok: !c.error }));
}

/**
 * A rough, clearly-labeled cost estimate for the ai_runs.cost_estimate
 * column (spec section 10/45) — intentionally simple, using a small
 * hard-coded per-1K-token table for the model families this app is
 * configured to use, rather than an external pricing API. `null` (not a
 * fabricated number) when the model isn't recognized, since spec section 4
 * ("never invent business data") applies to cost figures too.
 */
const USD_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
};

function estimateCostUsd(model: string | null, tokensInput: number | null, tokensOutput: number | null): number | null {
  if (!model || tokensInput == null || tokensOutput == null) return null;
  const rates = Object.entries(USD_PER_1K_TOKENS).find(([key]) => model.startsWith(key))?.[1];
  if (!rates) return null;
  return Number(((tokensInput / 1000) * rates.input + (tokensOutput / 1000) * rates.output).toFixed(6));
}

/**
 * Deterministic, transparent lead-qualification scoring (Phase 4 spec
 * section 7 — "do NOT create a fake mathematical 'AI score' without
 * documenting how it is calculated... create a transparent scoring
 * function/configuration... document the scoring model").
 *
 * The model is NOT the AI inventing a number. The AI's job is to estimate
 * each of the six named factors below from the conversation (each a 0–1
 * confidence/strength), and this pure function turns those factors into a
 * score and a temperature recommendation using a fixed, documented formula.
 * The `update_conversation_state` / `update_lead` / `create_lead` AI tools
 * (src/lib/ai/tools/write.ts) validate that any score/temperature they're
 * asked to store is consistent with what this function would produce from
 * the given factors — the model cannot just assert "score: 95".
 *
 * No I/O, no Supabase — fully unit-testable in isolation (scoring.test.ts).
 */

/** Each factor is a 0 (no evidence / worst case) – 1 (strong evidence / best case) confidence score. */
export type QualificationFactors = {
  /** How clearly the customer has stated what they want (spec section 7 "Intent"). */
  intentClarity: number;
  /** How well the customer appears to meet the known requirements for what they want (spec section 7 "Fit"). */
  fit: number;
  /** How soon the customer wants to proceed (spec section 7 "Urgency"). */
  urgency: number;
  /** How much of the required information/documentation is already available (spec section 7 "Completeness"). */
  completeness: number;
  /** Whether the customer is actively responding and moving the conversation forward (spec section 7 "Engagement"). */
  engagement: number;
  /** Whether there is a matching, currently OPEN opportunity for what the customer wants (spec section 7 "Opportunity relevance"). */
  opportunityRelevance: number;
};

/**
 * Fixed factor weights, summing to 1.0. Intent and fit weigh most heavily —
 * a customer who clearly wants something they qualify for is the strongest
 * signal — with the rest contributing meaningfully but not dominating.
 * Changing these weights changes every future score; do it here, in one
 * place, never inline in a prompt or a one-off tool.
 */
export const QUALIFICATION_WEIGHTS: Record<keyof QualificationFactors, number> = {
  intentClarity: 0.2,
  fit: 0.2,
  urgency: 0.15,
  completeness: 0.15,
  engagement: 0.15,
  opportunityRelevance: 0.15,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Computes a 0–100 lead score from qualification factors. Every input is
 * clamped to [0, 1] first — a malformed or out-of-range factor from the
 * model degrades gracefully rather than producing a nonsensical score.
 */
export function computeLeadScore(factors: Partial<QualificationFactors>): number {
  let total = 0;
  for (const key of Object.keys(QUALIFICATION_WEIGHTS) as (keyof QualificationFactors)[]) {
    const value = clamp01(factors[key] ?? 0);
    total += value * QUALIFICATION_WEIGHTS[key];
  }
  return Math.round(total * 100);
}

/**
 * The lead's stored temperature (spec section 8), using the SAME three
 * values the existing `leads.temperature` column already supports
 * (hot/warm/nurture — see supabase/migrations/0001_init.sql). Thresholds
 * are fixed and documented, not left to the model to decide.
 */
export function recommendTemperature(score: number): "hot" | "warm" | "nurture" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "nurture";
}

/**
 * A finer, four-value DISPLAY label (spec section 8: "Support: HOT, WARM,
 * COLD, NURTURE"). This is presentation-only — it is never written to
 * `leads.temperature` (which stays hot/warm/nurture, per 0007's migration
 * note, to avoid widening a column 15+ already-shipped Phase 1 UI files
 * depend on). "Cold" is the bottom slice of what the database stores as
 * "nurture" — a genuinely cold lead (score < 15) and a merely low-priority
 * nurture lead (15–39) are both stored the same way today, but the AI Sales
 * Agent panel and any future analytics can still show the finer distinction
 * using this function.
 */
export function qualificationLabel(score: number): "hot" | "warm" | "cold" | "nurture" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  if (score >= 15) return "nurture";
  return "cold";
}

export type QualificationRecommendation = {
  score: number;
  temperature: "hot" | "warm" | "nurture";
  label: "hot" | "warm" | "cold" | "nurture";
};

/** Convenience wrapper combining the three functions above — what AI tools actually call. */
export function recommendQualification(factors: Partial<QualificationFactors>): QualificationRecommendation {
  const score = computeLeadScore(factors);
  return { score, temperature: recommendTemperature(score), label: qualificationLabel(score) };
}

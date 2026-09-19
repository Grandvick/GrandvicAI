/**
 * Pure decision logic for hot-lead owner notifications (spec section 19 —
 * "🔥 HOT LEAD" alerts). Kept separate from leads.ts (which does the actual
 * database writes) so the rule itself is trivially unit-testable.
 *
 * This is a simple transition rule, not the AI lead-scoring engine —
 * scoring/qualification automation is Phase 4. Phase 1 only reacts when the
 * owner (or staff) manually marks a lead "hot".
 */
export function shouldNotifyHotLead(
  previousTemperature: string | null | undefined,
  newTemperature: string
): boolean {
  return newTemperature === "hot" && previousTemperature !== "hot";
}

export function buildHotLeadNotification(params: {
  customerName: string;
  service?: string | null;
  targetCountry?: string | null;
  score: number;
}) {
  const parts = [`Customer: ${params.customerName}`];
  if (params.service) parts.push(`Service: ${params.service}`);
  if (params.targetCountry) parts.push(`Destination: ${params.targetCountry}`);
  parts.push(`Lead score: ${params.score}`);

  return {
    title: `🔥 Hot lead: ${params.customerName}`,
    body: parts.join(" · ") + "\n\nRecommended action: contact this customer.",
    level: "important" as const,
  };
}

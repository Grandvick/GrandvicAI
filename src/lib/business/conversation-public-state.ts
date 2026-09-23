import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationMode, ConversationState } from "./conversations";
import { getLead } from "./leads";
import { getJob } from "./jobs";

/**
 * The dashboard-facing shape of a conversation's structured state (spec
 * section 22 — intent, lead temperature/score, matched opportunity title,
 * qualification, human-takeover state all visible without a second
 * round-trip from the client). Extracted in Phase 5D from what was a local
 * `buildPublicState()` inside src/app/api/ai/sales-agent/route.ts, so the
 * WhatsApp orchestration layer (src/lib/channels/whatsapp/orchestrate.ts)
 * can return the exact same shape the website-channel route already does,
 * rather than reimplementing the lead/job enrichment a second time.
 */
export type ConversationPublicState = {
  id: string;
  mode: ConversationMode;
  intent: string | null;
  leadId: string | null;
  leadTemperature: string | null;
  leadScore: number | null;
  leadStage: string | null;
  matchedOpportunityId: string | null;
  matchedOpportunityTitle: string | null;
  qualification: Record<string, unknown>;
  handoverReason: string | null;
};

export async function buildConversationPublicState(
  supabase: SupabaseClient,
  state: ConversationState
): Promise<ConversationPublicState> {
  const [lead, job] = await Promise.all([
    state.leadId ? getLead(supabase, state.leadId).catch(() => null) : Promise.resolve(null),
    state.matchedOpportunityId ? getJob(supabase, state.matchedOpportunityId).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    id: state.id,
    mode: state.mode,
    intent: state.intent,
    leadId: state.leadId,
    leadTemperature: lead?.temperature ?? null,
    leadScore: lead?.score ?? null,
    leadStage: lead?.stage ?? null,
    matchedOpportunityId: state.matchedOpportunityId,
    matchedOpportunityTitle: job?.title ?? null,
    qualification: state.qualification,
    handoverReason: state.handoverReason,
  };
}

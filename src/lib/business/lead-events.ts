import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdByName: string | null;
  createdAt: string;
};

export async function logLeadEvent(
  supabase: SupabaseClient,
  params: {
    leadId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  }
) {
  const { error } = await supabase.from("lead_events").insert({
    lead_id: params.leadId,
    event_type: params.eventType,
    payload: params.payload ?? {},
    created_by: params.createdBy ?? null,
  });
  if (error) throw error;
}

export async function listLeadEvents(
  supabase: SupabaseClient,
  leadId: string
): Promise<LeadEvent[]> {
  const { data, error } = await supabase
    .from("lead_events")
    .select("id, event_type, payload, created_at, profiles:created_by (full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((e) => ({
    id: e.id as string,
    eventType: e.event_type as string,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdByName:
      (e.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
    createdAt: e.created_at as string,
  }));
}

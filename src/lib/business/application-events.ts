import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-application activity timeline (Phase 2, mirrors lead-events.ts).
 * Distinct from the flat cross-entity `audit_logs` table — this feeds the
 * application/job detail views' "Activity history" (spec section 11).
 */
export type ApplicationEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdByName: string | null;
  createdAt: string;
};

export async function logApplicationEvent(
  supabase: SupabaseClient,
  params: {
    applicationId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  }
) {
  const { error } = await supabase.from("application_events").insert({
    application_id: params.applicationId,
    event_type: params.eventType,
    payload: params.payload ?? {},
    created_by: params.createdBy ?? null,
  });
  if (error) throw error;
}

export async function listApplicationEvents(
  supabase: SupabaseClient,
  applicationId: string
): Promise<ApplicationEvent[]> {
  const { data, error } = await supabase
    .from("application_events")
    .select("id, event_type, payload, created_at, profiles:created_by (full_name)")
    .eq("application_id", applicationId)
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

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OpportunityOption = { id: string; title: string; status: string; country: string | null };

/**
 * Read-only opportunity list, for linking a lead/application to an
 * opportunity. Full opportunity management (create/edit, status, expiry
 * enforcement) is Phase 2's Jobs Module — deliberately not built here.
 */
export async function listOpportunitiesForSelect(
  supabase: SupabaseClient,
  businessId: string
): Promise<OpportunityOption[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, title, status, country")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as OpportunityOption[];
}

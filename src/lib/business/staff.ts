import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StaffOption = { id: string; name: string };

/**
 * Users assignable to a lead/task — staff scoped to this business, plus the
 * Owner (whose profile has business_id = null but who can be assigned
 * anything across every business). Used to populate "Assigned to" selectors.
 */
export async function listStaff(
  supabase: SupabaseClient,
  businessId: string
): Promise<StaffOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, business_id, is_active")
    .or(`business_id.eq.${businessId},business_id.is.null`)
    .eq("is_active", true)
    .order("full_name");

  if (error) throw error;

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string | null) ?? "Unnamed",
  }));
}

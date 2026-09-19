import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessOption = { id: string; name: string; slug: string };
export type ModuleOption = { id: string; key: string; name: string; businessId: string };

/** For populating "Business" selectors — never hard-codes Grandvic. */
export async function listBusinesses(supabase: SupabaseClient): Promise<BusinessOption[]> {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as BusinessOption[];
}

/** For populating "Module" selectors (Jobs Abroad / Visa Services / Tours & Safaris, etc). */
export async function listBusinessModules(
  supabase: SupabaseClient,
  businessId?: string
): Promise<ModuleOption[]> {
  let query = supabase
    .from("business_modules")
    .select("id, key, name, business_id")
    .eq("is_enabled", true)
    .order("name");
  if (businessId) query = query.eq("business_id", businessId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id as string,
    key: m.key as string,
    name: m.name as string,
    businessId: m.business_id as string,
  }));
}

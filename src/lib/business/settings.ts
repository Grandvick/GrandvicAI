import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessSettingItem = {
  category: string;
  key: string;
  value: unknown;
  updatedAt: string;
};

/**
 * Read-only view of `public.settings` (spec section 35 — "key/value business
 * configuration, never secrets in plaintext"). No writer exists yet because
 * no phase has shipped a settings-editing UI; this is the first reader,
 * added in Phase 3 to back the AI Core's `get_business_settings` tool. Since
 * the table is designed to never hold secrets (integration tokens live in
 * environment variables only — see ARCHITECTURE.md section 10), it's safe
 * for the AI to read in full.
 */
export async function getBusinessSettings(
  supabase: SupabaseClient,
  businessId: string,
  opts: { category?: string } = {}
): Promise<BusinessSettingItem[]> {
  let query = supabase
    .from("settings")
    .select("category, key, value, updated_at")
    .eq("business_id", businessId)
    .order("category", { ascending: true });

  if (opts.category) query = query.eq("category", opts.category);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r) => ({
    category: r.category as string,
    key: r.key as string,
    value: r.value,
    updatedAt: r.updated_at as string,
  }));
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves an inbound webhook's `phone_number_id` to a `business_id` via
 * `whatsapp_business_accounts` (Phase 5A's mapping table — see
 * 0008_whatsapp_channel.sql). Phase 5F, section B/I of the Phase 5 plan:
 * this is the ONLY source of truth the webhook route uses for `business_id`
 * — never the payload's own free-text fields — so that even though the
 * caller uses the service-role client (RLS bypassed), the application code
 * enforces the identical business-scoping boundary manually. Only
 * `is_active = true` accounts resolve, so a disconnected/deactivated
 * number cannot route traffic to a business without a code change and a
 * genuine re-activation of that row.
 *
 * Returns null both when no account is mapped for that phone_number_id at
 * all AND when one exists but is inactive — the caller (route.ts) cannot
 * distinguish "unknown number" from "known but disabled" from this alone,
 * which is intentional: either way, this webhook has nowhere safe to route
 * to, and the caller's response to Meta is the same either way (acknowledge
 * and drop, logged server-side for an operator to investigate).
 */
export async function resolveWhatsAppBusinessId(
  supabase: SupabaseClient,
  phoneNumberId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("whatsapp_business_accounts")
    .select("business_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.business_id as string) : null;
}

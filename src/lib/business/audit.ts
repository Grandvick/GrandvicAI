import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntry = {
  businessId: string | null;
  actorType?: "user" | "system" | "ai";
  actorId?: string | null;
  action: string; // e.g. "lead.stage_changed", "customer.created"
  objectType?: string;
  objectId?: string | null;
  result?: "success" | "failure";
  metadata?: Record<string, unknown>;
};

/**
 * Writes one row to audit_logs (spec section 34 — every important system
 * action is logged). Intentionally fire-and-forget-safe: a logging failure
 * must never fail the mutation it's describing, so this swallows errors
 * after logging them to the server console.
 */
export async function logActivity(supabase: SupabaseClient, entry: AuditEntry) {
  try {
    await supabase.from("audit_logs").insert({
      business_id: entry.businessId,
      actor_type: entry.actorType ?? "user",
      actor_id: entry.actorId ?? null,
      action: entry.action,
      object_type: entry.objectType ?? null,
      object_id: entry.objectId ?? null,
      result: entry.result ?? "success",
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.error("audit log write failed", entry.action, err);
  }
}

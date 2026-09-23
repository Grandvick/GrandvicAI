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

export type ActivityLogItem = {
  id: string;
  actorType: "user" | "system" | "ai";
  actorId: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  result: "success" | "failure";
  metadata: Record<string, unknown>;
  createdAt: string;
};

/**
 * Read-only view of `audit_logs` (append-only, spec section 34). Added in
 * Phase 3 to back the AI Core's `get_recent_activity` tool — audit_logs
 * itself and its RLS policy (`audit_logs_select`) already existed since
 * Phase 0; this is the first reader for it.
 */
export async function listRecentActivity(
  supabase: SupabaseClient,
  businessId: string,
  opts: { limit?: number; since?: string; objectType?: string } = {}
): Promise<ActivityLogItem[]> {
  let query = supabase
    .from("audit_logs")
    .select("id, actor_type, actor_id, action, object_type, object_id, result, metadata, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);

  if (opts.since) query = query.gte("created_at", opts.since);
  if (opts.objectType) query = query.eq("object_type", opts.objectType);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id as string,
    actorType: r.actor_type as ActivityLogItem["actorType"],
    actorId: r.actor_id as string | null,
    action: r.action as string,
    objectType: r.object_type as string | null,
    objectId: r.object_id as string | null,
    result: r.result as ActivityLogItem["result"],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
  }));
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PipelineStage = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  moduleId: string | null;
};

const FALLBACK_STAGES: Omit<PipelineStage, "id" | "moduleId">[] = [
  { key: "new", label: "New", sortOrder: 1 },
  { key: "contacted", label: "Contacted", sortOrder: 2 },
  { key: "qualified", label: "Qualified", sortOrder: 3 },
  { key: "assessment", label: "Assessment", sortOrder: 4 },
  { key: "payment", label: "Payment", sortOrder: 5 },
  { key: "documents", label: "Documents", sortOrder: 6 },
  { key: "application", label: "Application", sortOrder: 7 },
  { key: "submitted", label: "Submitted", sortOrder: 8 },
  { key: "interview", label: "Interview", sortOrder: 9 },
  { key: "completed", label: "Completed / Closed", sortOrder: 10 },
];

/**
 * Configurable pipeline stages (spec section 16). Reads from
 * `pipeline_stages`, scoped to the business (and module, when the lead
 * belongs to one). Falls back to the default recruitment pipeline shape if
 * a business/module combination has none configured yet, so the Kanban
 * board is never empty just because nobody has set up stages for a brand
 * new module.
 */
export async function listPipelineStages(
  supabase: SupabaseClient,
  businessId: string
): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, key, label, sort_order, module_id")
    .eq("business_id", businessId)
    .order("sort_order");

  if (error) throw error;

  if (!data || data.length === 0) {
    return FALLBACK_STAGES.map((s, i) => ({ ...s, id: `fallback-${i}`, moduleId: null }));
  }

  // De-duplicate by stage key across modules for a single unified board —
  // Phase 1 shows one pipeline view; per-module pipelines can be split out
  // once there's a module switcher in a later phase.
  const seen = new Map<string, PipelineStage>();
  for (const row of data) {
    const key = row.key as string;
    if (!seen.has(key)) {
      seen.set(key, {
        id: row.id as string,
        key,
        label: row.label as string,
        sortOrder: row.sort_order as number,
        moduleId: row.module_id as string | null,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

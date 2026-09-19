import { describe, expect, it } from "vitest";
import { listPipelineStages } from "./pipeline-stages";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeFakeSupabase(rows: unknown[]): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => builder } as any;
}

describe("listPipelineStages", () => {
  it("falls back to the default recruitment pipeline when none are configured", async () => {
    const supabase = makeFakeSupabase([]);
    const stages = await listPipelineStages(supabase, "business-1");

    expect(stages.length).toBeGreaterThan(0);
    expect(stages[0].key).toBe("new");
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].sortOrder).toBeGreaterThanOrEqual(stages[i - 1].sortOrder);
    }
  });

  it("de-duplicates stage keys across modules and sorts by sort_order", async () => {
    const supabase = makeFakeSupabase([
      { id: "a", key: "contacted", label: "Contacted", sort_order: 2, module_id: "m1" },
      { id: "b", key: "new", label: "New", sort_order: 1, module_id: "m1" },
      { id: "c", key: "new", label: "New (dup)", sort_order: 1, module_id: "m2" },
    ]);

    const stages = await listPipelineStages(supabase, "business-1");

    expect(stages.map((s) => s.key)).toEqual(["new", "contacted"]);
    expect(stages[0].id).toBe("b"); // first occurrence of a duplicate key wins
  });
});

import { describe, expect, it } from "vitest";
import { getDashboardOverview } from "./dashboard";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Minimal fake of the Supabase query-builder chain (`.from().select().eq()...`)
 * that resolves like a real PostgREST query (it's a "thenable"). Lets us test
 * getDashboardOverview's aggregation and error-handling logic without a real
 * database — appropriate for Phase 0, where the point is to prove the
 * dashboard degrades gracefully rather than to test real business rules
 * (lead scoring, job expiry, etc. get their own tests in Phases 2 and 4).
 */
function makeFakeSupabase(countsByTable: Record<string, number>): SupabaseClient {
  const chain = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      lte: () => builder,
      in: () => builder,
      then: (resolve: (v: { count: number; error: null }) => void) =>
        resolve({ count: countsByTable[table] ?? 0, error: null }),
    };
    return builder;
  };

  return {
    from: (table: string) => chain(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeThrowingSupabase(): SupabaseClient {
  return {
    from: () => {
      throw new Error("network error");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getDashboardOverview", () => {
  it("maps table counts onto the overview shape", async () => {
    const supabase = makeFakeSupabase({
      leads: 5,
      tasks: 2,
      applications: 3,
      documents: 1,
      payments: 4,
      content: 6,
      content_calendar: 7,
    });

    const { data, error } = await getDashboardOverview(supabase);

    expect(error).toBeNull();
    expect(data.newLeads).toBe(5);
    expect(data.hotLeads).toBe(5);
    expect(data.followUpsDue).toBe(2);
    expect(data.activeApplications).toBe(3);
    expect(data.pendingDocuments).toBe(1);
    expect(data.paymentsDue).toBe(4);
    expect(data.contentAwaitingApproval).toBe(6);
    expect(data.scheduledPosts).toBe(7);
  });

  it("falls back to a zeroed overview with a friendly error when the query fails", async () => {
    const supabase = makeThrowingSupabase();

    const { data, error } = await getDashboardOverview(supabase);

    expect(error).toMatch(/migration/i);
    expect(data).toEqual({
      newLeads: 0,
      hotLeads: 0,
      warmLeads: 0,
      followUpsDue: 0,
      activeApplications: 0,
      pendingDocuments: 0,
      paymentsDue: 0,
      contentAwaitingApproval: 0,
      scheduledPosts: 0,
    });
  });
});

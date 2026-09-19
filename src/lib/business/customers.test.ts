import { describe, expect, it } from "vitest";
import { listCustomers } from "./customers";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeFakeSupabase(rows: unknown[]): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => builder } as any;
}

describe("listCustomers", () => {
  it("extracts the lead count from the leads(count) aggregate", async () => {
    const supabase = makeFakeSupabase([
      {
        id: "c1",
        full_name: "Jane Doe",
        phone: "+254700000000",
        email: null,
        country: "Kenya",
        profession: "Nurse",
        created_at: "2026-01-01T00:00:00Z",
        leads: [{ count: 3 }],
      },
      {
        id: "c2",
        full_name: "John Smith",
        phone: null,
        email: null,
        country: null,
        profession: null,
        created_at: "2026-01-02T00:00:00Z",
        leads: [{ count: 0 }],
      },
    ]);

    const customers = await listCustomers(supabase, "business-1", {});

    expect(customers).toHaveLength(2);
    expect(customers[0].leadCount).toBe(3);
    expect(customers[1].leadCount).toBe(0);
  });

  it("defaults to zero leads when the aggregate is missing", async () => {
    const supabase = makeFakeSupabase([
      {
        id: "c1",
        full_name: "Jane Doe",
        phone: null,
        email: null,
        country: null,
        profession: null,
        created_at: "2026-01-01T00:00:00Z",
        leads: [],
      },
    ]);

    const customers = await listCustomers(supabase, "business-1", {});
    expect(customers[0].leadCount).toBe(0);
  });
});

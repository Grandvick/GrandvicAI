import { describe, expect, it } from "vitest";
import { listCustomers, findCustomerByContact, normalizePhone } from "./customers";
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

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    full_name: "Jane Doe",
    phone: "+254700000000",
    email: "jane@example.com",
    country: "Kenya",
    profession: "Nurse",
    created_at: "2026-01-01T00:00:00Z",
    leads: [],
    ...overrides,
  };
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

describe("findCustomerByContact (Phase 4 spec section 4 — customer identification)", () => {
  it("returns an empty array when neither phone nor email is given, without querying", async () => {
    const supabase = makeFakeSupabase([customerRow()]);
    const matches = await findCustomerByContact(supabase, "business-1", {});
    expect(matches).toEqual([]);
  });

  it("returns no matches when nothing matches (safe to create a new customer)", async () => {
    const supabase = makeFakeSupabase([]);
    const matches = await findCustomerByContact(supabase, "business-1", { phone: "+254700000000" });
    expect(matches).toEqual([]);
  });

  it("returns exactly one match when unambiguous (safe to reuse)", async () => {
    const supabase = makeFakeSupabase([customerRow()]);
    const matches = await findCustomerByContact(supabase, "business-1", { phone: "+254700000000" });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("c1");
  });

  it("returns every match when ambiguous, rather than guessing one (spec: flag for human review)", async () => {
    const supabase = makeFakeSupabase([
      customerRow({ id: "c1" }),
      customerRow({ id: "c2", full_name: "Jane Doe (duplicate record)" }),
    ]);
    const matches = await findCustomerByContact(supabase, "business-1", { email: "jane@example.com" });
    expect(matches).toHaveLength(2);
  });

  // ---------------------------------------------------------------------
  // Live-testing follow-up (fourth diagnostic pass): a customer stored as
  // "+254799999911" (from a form) never matched a chat message typed as
  // "254799999911" or "799999911" — a plain `.eq()` treats any formatting
  // difference as a totally different number. The user explicitly wants
  // the country code to STAY significant (they get clients outside Kenya
  // too), so this is formatting-only normalization, never a guess at
  // country code.
  // ---------------------------------------------------------------------
  describe("phone matching is normalized (formatting-insensitive, country-code-sensitive)", () => {
    it("matches the same number typed with a leading '+', without one, and with spaces/dashes/parens", async () => {
      const supabase = makeFakeSupabase([customerRow({ phone: "+254799999911" })]);

      for (const typed of ["+254799999911", "254799999911", "254 799 999 911", "(254) 799-999-911"]) {
        const matches = await findCustomerByContact(supabase, "business-1", { phone: typed });
        expect(matches).toHaveLength(1);
      }
    });

    it("matches regardless of which of the two forms was STORED, not just which was typed", async () => {
      // Stored without a country code prefix or "+" at all — a customer
      // record entered as a bare local number — still matches a search
      // that includes formatting the stored value didn't have.
      const supabase = makeFakeSupabase([customerRow({ phone: "799999911" })]);
      const matches = await findCustomerByContact(supabase, "business-1", { phone: "799999911" });
      expect(matches).toHaveLength(1);
    });

    it("never treats two DIFFERENT numbers as the same just because their trailing digits match — the country code stays significant", async () => {
      const supabase = makeFakeSupabase([customerRow({ phone: "+254799999911" })]);
      // Same trailing 9 digits, different country code — must NOT match.
      const matches = await findCustomerByContact(supabase, "business-1", { phone: "+1799999911" });
      expect(matches).toEqual([]);
    });

    it("still returns no match for a genuinely different number, formatting normalization aside", async () => {
      const supabase = makeFakeSupabase([customerRow({ phone: "+254799999911" })]);
      const matches = await findCustomerByContact(supabase, "business-1", { phone: "+254700000000" });
      expect(matches).toEqual([]);
    });

    it("matches on phone even when email is also given but points elsewhere (an OR, not an AND)", async () => {
      const supabase = makeFakeSupabase([customerRow({ phone: "+254799999911", email: "someone-else@example.com" })]);
      const matches = await findCustomerByContact(supabase, "business-1", {
        phone: "254 799 999 911",
        email: "not-the-same@example.com",
      });
      expect(matches).toHaveLength(1);
    });
  });
});

describe("normalizePhone", () => {
  it("strips spaces, dashes, parentheses, dots, and a leading '+', keeping only digits", () => {
    expect(normalizePhone("+254 799-999-911")).toBe("254799999911");
    expect(normalizePhone("(254) 799.999.911")).toBe("254799999911");
    expect(normalizePhone("254799999911")).toBe("254799999911");
  });

  it("never strips the country code itself — only separator characters", () => {
    expect(normalizePhone("+254799999911")).not.toBe(normalizePhone("+1799999911"));
  });
});

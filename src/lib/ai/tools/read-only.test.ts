import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeTool } from "./registry";
import { makeFakeSupabase, type FakeTables } from "@/test/fake-supabase";
import type { AiToolContext } from "../types";

function ctxWith(tables: FakeTables, overrides: Partial<AiToolContext> = {}): AiToolContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeFakeSupabase(tables) as any,
    userId: "user-1",
    roleKey: "owner",
    isOwner: true,
    businessId: "biz-1",
    businessName: "Grandvic Tours & Travel",
    now: new Date("2026-09-20T00:00:00.000Z"),
    conversationId: null,
    ...overrides,
  };
}

describe("AI tools — real business-layer read handlers (spec section 20 items 6-9)", () => {
  it("get_customer returns structured customer detail, not a raw row or an error leak", async () => {
    const customerId = randomUUID();
    const ctx = ctxWith({
      customers: [
        {
          id: customerId,
          business_id: "biz-1",
          full_name: "Jane Wanjiru",
          phone: "+254711000001",
          email: "jane@example.com",
          country: "Kenya",
          profession: "Registered Nurse",
          notes: null,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          leads: [{ count: 2 }],
        },
      ],
    });

    const result = (await executeTool(ctx, "get_customer", { customerId })) as {
      fullName: string;
      leadCount: number;
    };

    expect(result.fullName).toBe("Jane Wanjiru");
    expect(result.leadCount).toBe(2);
  });

  it("get_customer reports a clear not-found error rather than throwing a raw exception", async () => {
    const ctx = ctxWith({ customers: [] });
    await expect(executeTool(ctx, "get_customer", { customerId: randomUUID() })).rejects.toThrow(/no customer found/i);
  });

  it("get_hot_leads returns only hot, active leads with a usable customer name", async () => {
    const ctx = ctxWith({
      leads: [
        {
          id: randomUUID(),
          business_id: "biz-1",
          customer_id: randomUUID(),
          service: "Jobs Abroad",
          target_country: "Luxembourg",
          source: "whatsapp",
          stage: "documents",
          score: 91,
          temperature: "hot",
          assigned_to: null,
          is_active: true,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          customers: { full_name: "Jane Wanjiru", phone: "+254711000001" },
          assignee: null,
        },
      ],
    });

    const result = (await executeTool(ctx, "get_hot_leads", {})) as { customerName: string; temperature: string }[];

    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Jane Wanjiru");
    expect(result[0].temperature).toBe("hot");
  });

  it("get_open_jobs excludes a job whose stored status is still 'open' but has actually expired", async () => {
    const openJobId = randomUUID();
    const staleJobId = randomUUID();
    const ctx = ctxWith({
      opportunities: [
        {
          id: openJobId,
          business_id: "biz-1",
          title: "Registered Nurse — Luxembourg",
          country: "Luxembourg",
          city: "Luxembourg City",
          employer: null,
          recruiter_name: null,
          category: null,
          employment_type: "full_time",
          num_vacancies: 5,
          salary_amount: 2400,
          salary_currency: "EUR",
          salary_period: "monthly",
          status: "open",
          application_deadline: null,
          expiry_at: "2026-12-01T00:00:00.000Z", // future — genuinely still open
          published_at: null,
          closed_at: null,
          source: "demo_seed",
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          applications: [{ count: 0 }],
        },
        {
          id: staleJobId,
          business_id: "biz-1",
          title: "Hospitality Supervisor — Qatar",
          country: "Qatar",
          city: "Doha",
          employer: null,
          recruiter_name: null,
          category: null,
          employment_type: "contract",
          num_vacancies: 2,
          salary_amount: 1600,
          salary_currency: "USD",
          salary_period: "monthly",
          status: "open", // stale — expiry already passed, effective status must be "expired"
          application_deadline: null,
          expiry_at: "2026-01-01T00:00:00.000Z",
          published_at: null,
          closed_at: null,
          source: "demo_seed",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          applications: [{ count: 0 }],
        },
      ],
    });

    const result = (await executeTool(ctx, "get_open_jobs", {})) as { id: string }[];

    expect(result.map((j) => j.id)).toEqual([openJobId]);
  });

  it("get_missing_documents reports an applicant missing a mandatory document, and omits one with nothing missing", async () => {
    const jobId = randomUUID();
    const missingAppId = randomUUID();
    const completeAppId = randomUUID();
    const ctx = ctxWith({
      applications: [
        {
          id: missingAppId,
          business_id: "biz-1",
          customer_id: randomUUID(),
          lead_id: null,
          opportunity_id: jobId,
          status: "documents_pending",
          rejection_reason: null,
          notes: null,
          submitted_at: null,
          created_at: "2026-09-01T00:00:00.000Z",
          customers: { full_name: "Jane Wanjiru" },
          opportunities: { title: "Registered Nurse — Luxembourg" },
        },
        {
          id: completeAppId,
          business_id: "biz-1",
          customer_id: randomUUID(),
          lead_id: null,
          opportunity_id: jobId,
          status: "documents_complete",
          rejection_reason: null,
          notes: null,
          submitted_at: null,
          created_at: "2026-09-02T00:00:00.000Z",
          customers: { full_name: "Peter Otieno" },
          opportunities: { title: "Registered Nurse — Luxembourg" },
        },
      ],
      document_requirements: [
        { id: randomUUID(), opportunity_id: jobId, document_type: "passport", is_mandatory: true, notes: null },
      ],
      documents: [
        // Only the complete candidate has actually submitted their passport.
        { id: randomUUID(), application_id: completeAppId, document_type: "passport", status: "approved" },
      ],
    });

    const result = (await executeTool(ctx, "get_missing_documents", { jobId })) as {
      customerName: string;
      missingDocuments: string[];
    }[];

    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Jane Wanjiru");
    expect(result[0].missingDocuments).toEqual(["passport"]);
  });
});

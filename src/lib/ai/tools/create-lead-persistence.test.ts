import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeTool } from "./registry";
import { listLeads } from "@/lib/business/leads";
import { listApplications } from "@/lib/business/applications";
import { makeFakeSupabase, type FakeTables } from "@/test/fake-supabase";
import type { AiToolContext } from "../types";

/**
 * Phase 4 AI Sales Agent diagnostic task, item 5 — a regression test that
 * proves `create_lead` genuinely PERSISTS through the REAL, unmocked
 * business-logic layer (@/lib/business/customers, leads, applications,
 * jobs), and that the result is retrievable through the exact same data
 * layer /leads uses (listLeads).
 *
 * This is deliberately DIFFERENT from write.test.ts's existing coverage:
 * that file mocks @/lib/business/{customers,leads,applications,jobs}
 * entirely, so it only proves the AI tool layer calls those functions with
 * the right arguments — it can never catch a bug in createLead()/
 * createApplication() themselves, or prove a row is actually retrievable
 * afterwards. This file mocks NOTHING from @/lib/business — every write
 * goes through the real createCustomer/createLead/createApplication/getJob
 * functions, backed by fake-supabase.ts's now-persistence-capable in-memory
 * tables (see that file's comment for how .insert() was fixed).
 *
 * No demo-specific data (spec item 8 — do not hard-code the Luxembourg
 * nursing job or any specific test persona): every id is a freshly
 * generated UUID and every name/service/country below is generic synthetic
 * test data, unrelated to any real business's seed data.
 */

const BUSINESS_ID = randomUUID();
const OTHER_BUSINESS_ID = randomUUID();
const USER_ID = randomUUID();

function fakeCtx(tables: FakeTables, overrides: Partial<AiToolContext> = {}): AiToolContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeFakeSupabase(tables) as any,
    userId: USER_ID,
    roleKey: "owner",
    isOwner: true,
    businessId: BUSINESS_ID,
    businessName: "Test Business",
    now: new Date("2026-09-20T00:00:00.000Z"),
    conversationId: null,
    ...overrides,
  };
}

function seedOpenJob(businessId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: randomUUID(),
    business_id: businessId,
    title: "Test Open Role",
    country: "Testland",
    status: "open",
    expiry_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("create_lead really persists (Phase 4 diagnostic task item 5)", () => {
  it("writes a real lead row, scoped to the calling business and linked to the resolved customer, retrievable via listLeads (the /leads data layer)", async () => {
    const tables: FakeTables = {};
    const ctx = fakeCtx(tables);

    const customer = (await executeTool(ctx, "create_customer", {
      fullName: "Regression Test Customer",
      phone: "+10000000001",
    })) as { created: boolean; customerId: string };
    expect(customer.created).toBe(true);
    expect(customer.customerId).toBeTruthy();

    const leadResult = (await executeTool(ctx, "create_lead", {
      customerId: customer.customerId,
      service: "Test Service",
      targetCountry: "Testland",
      qualification: { fit: 0.5, urgency: 0.4 },
    })) as { created: boolean; leadId: string };

    expect(leadResult.created).toBe(true);
    expect(leadResult.leadId).toBeTruthy();

    // Prove it through the REAL /leads read path, not by inspecting the
    // fake table directly — this is what "retrievable by the normal /leads
    // data layer" means.
    const leads = await listLeads(ctx.supabase, BUSINESS_ID, {});
    // fake-supabase.ts deliberately doesn't emulate real Postgres joins (see
    // its own header comment), so listLeads's nested `customers:customer_id
    // (full_name)` relation isn't populated here the way it would be
    // against a real database — this test instead asserts every
    // DIRECTLY-STORED column on the persisted row, which is what actually
    // proves genuine insert-then-retrieve persistence, scoping, and linkage.
    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe(leadResult.leadId);
    expect(leads[0].customerId).toBe(customer.customerId);
    expect(leads[0].businessId).toBe(BUSINESS_ID);
    expect(leads[0].service).toBe("Test Service");
    expect(leads[0].targetCountry).toBe("Testland");
  });

  it("is invisible to a different business's /leads query — persisted lead is correctly scoped by business_id", async () => {
    const tables: FakeTables = {};
    const ctx = fakeCtx(tables);

    const customer = (await executeTool(ctx, "create_customer", {
      fullName: "Cross Business Test Customer",
      email: "cross-business-test@example.com",
    })) as { customerId: string };
    await executeTool(ctx, "create_lead", { customerId: customer.customerId });

    const ownBusinessLeads = await listLeads(ctx.supabase, BUSINESS_ID, {});
    expect(ownBusinessLeads).toHaveLength(1);

    const otherBusinessLeads = await listLeads(ctx.supabase, OTHER_BUSINESS_ID, {});
    expect(otherBusinessLeads).toHaveLength(0);
  });

  it("links the lead to an OPEN job by creating a real application row (Phase 2 rules), retrievable via listApplications", async () => {
    const openJob = seedOpenJob(BUSINESS_ID);
    const tables: FakeTables = { opportunities: [openJob] };
    const ctx = fakeCtx(tables);

    const customer = (await executeTool(ctx, "create_customer", {
      fullName: "Job Linked Test Customer",
      phone: "+10000000002",
    })) as { customerId: string };

    const leadResult = (await executeTool(ctx, "create_lead", {
      customerId: customer.customerId,
      opportunityId: openJob.id,
    })) as { created: boolean; leadId: string; applicationId: string | null; jobTitle: string | null };

    expect(leadResult.applicationId).toBeTruthy();
    expect(leadResult.jobTitle).toBe(openJob.title);

    // Retrievable through the real applications data layer, not just the
    // tool's own return value.
    const applications = await listApplications(ctx.supabase, BUSINESS_ID, { leadId: leadResult.leadId });
    expect(applications).toHaveLength(1);
    expect(applications[0].customerId).toBe(customer.customerId);
    expect(applications[0].opportunityId).toBe(openJob.id);
    expect(applications[0].status).toBe("new");
  });

  it("refuses to link a job that is no longer open, and creates NO application row for it — proven via listApplications, not just the thrown error", async () => {
    const closedJob = seedOpenJob(BUSINESS_ID, { status: "closed" });
    const tables: FakeTables = { opportunities: [closedJob] };
    const ctx = fakeCtx(tables);

    const customer = (await executeTool(ctx, "create_customer", {
      fullName: "Closed Job Test Customer",
      phone: "+10000000003",
    })) as { customerId: string };

    await expect(
      executeTool(ctx, "create_lead", { customerId: customer.customerId, opportunityId: closedJob.id })
    ).rejects.toThrow(/no longer open/i);

    const applications = await listApplications(ctx.supabase, BUSINESS_ID, { opportunityId: closedJob.id });
    expect(applications).toHaveLength(0);
  });

  it("a lead created via create_lead is linked to the customer create_customer actually persisted — not a coincidentally-matching id", async () => {
    const tables: FakeTables = {};
    const ctx = fakeCtx(tables);

    const customerA = (await executeTool(ctx, "create_customer", {
      fullName: "Customer A",
      phone: "+10000000004",
    })) as { customerId: string };
    const customerB = (await executeTool(ctx, "create_customer", {
      fullName: "Customer B",
      phone: "+10000000005",
    })) as { customerId: string };

    const leadForB = (await executeTool(ctx, "create_lead", { customerId: customerB.customerId })) as {
      leadId: string;
    };

    const leads = await listLeads(ctx.supabase, BUSINESS_ID, {});
    const persistedLead = leads.find((l) => l.id === leadForB.leadId);
    expect(persistedLead?.customerId).toBe(customerB.customerId);
    expect(persistedLead?.customerId).not.toBe(customerA.customerId);
  });

  // ---------------------------------------------------------------------
  // Live-testing follow-up: create_lead was failing live with "Invalid
  // UUID" for a genuinely real, correctly-matched customer/job — root
  // cause was Zod's `.uuid()` additionally requiring RFC4122
  // version/variant nibbles that hand-typed, human-readable placeholder
  // ids (exactly the STYLE Phase 0's seed.sql demo data uses — e.g.
  // "00000000-0000-0000-0000-000000000101" for the real "[DEMO]
  // Registered Nurse — Luxembourg" job) don't have, even though they are
  // entirely valid Postgres `uuid` values. Fixed to `.guid()` (see
  // src/lib/ai/validation.ts's `dbId()`). This test proves the FULL
  // pipeline end to end for that exact class of id — real Zod validation,
  // real business logic, real persistence, real retrieval — using
  // generic synthetic data in the SAME id style, not the literal
  // Luxembourg job or any specific test persona (spec item 8).
  // ---------------------------------------------------------------------
  it("create_lead succeeds end-to-end for a hand-seeded, non-RFC4122 placeholder-style customer AND job id — proving the live 'Invalid UUID' failure is fixed, not just the schema-level check", async () => {
    const seedStyleCustomer = {
      id: "00000000-0000-0000-0000-000000000901",
      business_id: BUSINESS_ID,
      full_name: "Seed Style Test Customer",
      phone: "+10000000009",
      email: null,
      country: null,
      profession: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const seedStyleJob = seedOpenJob(BUSINESS_ID, {
      id: "00000000-0000-0000-0000-000000000902",
      title: "Seed Style Test Role",
    });
    const tables: FakeTables = { customers: [seedStyleCustomer], opportunities: [seedStyleJob] };
    const ctx = fakeCtx(tables);

    const leadResult = (await executeTool(ctx, "create_lead", {
      customerId: seedStyleCustomer.id,
      opportunityId: seedStyleJob.id,
    })) as { created: boolean; leadId: string; applicationId: string | null };

    expect(leadResult.created).toBe(true);
    expect(leadResult.applicationId).toBeTruthy();

    const leads = await listLeads(ctx.supabase, BUSINESS_ID, {});
    expect(leads.find((l) => l.id === leadResult.leadId)?.customerId).toBe(seedStyleCustomer.id);

    const applications = await listApplications(ctx.supabase, BUSINESS_ID, { leadId: leadResult.leadId });
    expect(applications[0]?.opportunityId).toBe(seedStyleJob.id);
  });
});

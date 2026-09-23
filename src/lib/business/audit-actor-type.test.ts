import { describe, expect, it } from "vitest";
import { createCustomer } from "./customers";
import { createLead, updateLeadPipeline } from "./leads";
import { createTask } from "./tasks";
import { createApplication } from "./applications";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 5F (Phase 5 plan, section I's "Audit trail" requirement): a real
 * WhatsApp webhook is the first caller that reaches these write functions
 * with a genuinely null actor (no signed-in staff member at all) outside a
 * dev-only test tool. Before this fix, every one of these calls logged
 * `actor_type: "user"` regardless of whether the actor was a real signed-in
 * person or a system/webhook-triggered write — making the two
 * indistinguishable in `audit_logs` after the fact. `actorId === null` is
 * an unambiguous signal for "system" throughout this codebase (see
 * AiToolContext.userId's doc comment and every call site of these
 * functions — grep confirms none ever passes null for any other reason).
 */
describe("audit_logs.actor_type reflects a null actor as 'system', not 'user' (Phase 5F)", () => {
  it("createCustomer: actor_type is 'system' when createdBy is null", async () => {
    const supabase = makeFakeSupabase({ customers: [], audit_logs: [] }) as unknown as SupabaseClient;
    await createCustomer(supabase, "biz-1", null, { fullName: "WhatsApp 254799999911", phone: "254799999911" });

    const { data } = await supabase.from("audit_logs").select("*");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ actor_type: "system", actor_id: null, action: "customer.created" });
  });

  it("createCustomer: actor_type stays 'user' for a real signed-in staff member", async () => {
    const supabase = makeFakeSupabase({ customers: [], audit_logs: [] }) as unknown as SupabaseClient;
    await createCustomer(supabase, "biz-1", "staff-1", { fullName: "Jane Doe", phone: "254700000000" });

    const { data } = await supabase.from("audit_logs").select("*");
    expect(data![0]).toMatchObject({ actor_type: "user", actor_id: "staff-1" });
  });

  it("createLead: actor_type is 'system' when createdBy is null", async () => {
    const supabase = makeFakeSupabase({ leads: [], lead_events: [], audit_logs: [] }) as unknown as SupabaseClient;
    await createLead(supabase, "biz-1", null, {
      customerId: "cust-1",
      stage: "new",
      score: 0,
      temperature: "nurture",
    });

    const { data } = await supabase.from("audit_logs").select("*");
    expect(data![0]).toMatchObject({ actor_type: "system", actor_id: null, action: "lead.created" });
  });

  it("updateLeadPipeline: actor_type is 'system' when updatedBy is null", async () => {
    const supabase = makeFakeSupabase({
      leads: [
        {
          id: "lead-1",
          business_id: "biz-1",
          stage: "new",
          score: 0,
          temperature: "nurture",
          assigned_to: null,
          service: null,
          target_country: null,
        },
      ],
      lead_events: [],
      audit_logs: [],
    }) as unknown as SupabaseClient;

    await updateLeadPipeline(supabase, "lead-1", null, { stage: "contacted" });

    const { data } = await supabase.from("audit_logs").select("*");
    expect(data![0]).toMatchObject({ actor_type: "system", actor_id: null, action: "lead.updated" });
  });

  it("createTask: actor_type is 'system' when ownerId is null", async () => {
    const supabase = makeFakeSupabase({ tasks: [], audit_logs: [] }) as unknown as SupabaseClient;
    await createTask(supabase, "biz-1", null, {
      title: "Follow up with customer",
      priority: "medium",
      status: "pending",
    });

    const { data } = await supabase.from("audit_logs").select("*");
    expect(data![0]).toMatchObject({ actor_type: "system", actor_id: null, action: "task.created" });
  });

  it("createApplication: actor_type is 'system' when createdBy is null", async () => {
    const supabase = makeFakeSupabase({
      applications: [],
      application_events: [],
      audit_logs: [],
    }) as unknown as SupabaseClient;

    await createApplication(supabase, "biz-1", null, { customerId: "cust-1", status: "new" });

    const { data } = await supabase.from("audit_logs").select("*");
    expect(data![0]).toMatchObject({ actor_type: "system", actor_id: null, action: "application.created" });
  });
});

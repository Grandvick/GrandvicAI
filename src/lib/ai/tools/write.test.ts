import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, getRegisteredTools } from "./registry";
import { AiToolError, AiValidationError } from "../errors";
import { recommendQualification } from "../qualification/scoring";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { AiToolContext } from "../types";

const findCustomerByContact = vi.fn();
const createCustomer = vi.fn();
vi.mock("@/lib/business/customers", () => ({
  findCustomerByContact: (...args: unknown[]) => findCustomerByContact(...args),
  createCustomer: (...args: unknown[]) => createCustomer(...args),
}));

const createLead = vi.fn();
const updateLeadPipeline = vi.fn();
const addLeadNote = vi.fn();
const findActiveLeadForCustomer = vi.fn();
const getLead = vi.fn();
vi.mock("@/lib/business/leads", () => ({
  createLead: (...args: unknown[]) => createLead(...args),
  updateLeadPipeline: (...args: unknown[]) => updateLeadPipeline(...args),
  addLeadNote: (...args: unknown[]) => addLeadNote(...args),
  findActiveLeadForCustomer: (...args: unknown[]) => findActiveLeadForCustomer(...args),
  getLead: (...args: unknown[]) => getLead(...args),
}));

const createApplication = vi.fn();
const listApplications = vi.fn();
vi.mock("@/lib/business/applications", () => ({
  createApplication: (...args: unknown[]) => createApplication(...args),
  listApplications: (...args: unknown[]) => listApplications(...args),
}));

const getJob = vi.fn();
vi.mock("@/lib/business/jobs", () => ({
  getJob: (...args: unknown[]) => getJob(...args),
}));

const createTask = vi.fn();
vi.mock("@/lib/business/tasks", () => ({
  createTask: (...args: unknown[]) => createTask(...args),
}));

const updateConversationState = vi.fn();
const getConversationState = vi.fn();
vi.mock("@/lib/business/conversations", () => ({
  updateConversationState: (...args: unknown[]) => updateConversationState(...args),
  getConversationState: (...args: unknown[]) => getConversationState(...args),
}));

const logConversationEvent = vi.fn();
vi.mock("@/lib/business/conversation-events", () => ({
  logConversationEvent: (...args: unknown[]) => logConversationEvent(...args),
  CONVERSATION_EVENT_TYPES: [
    "intent_detected",
    "qualification_started",
    "qualification_completed",
    "lead_created",
    "lead_updated",
    "opportunity_matched",
    "document_requirement_discussed",
    "application_status_requested",
    "human_handover",
    "ai_resumed",
    "follow_up_required",
  ],
}));

// Zod v4's `.uuid()` requires genuine RFC4122 version/variant nibbles —
// plain placeholder strings like "cust-1" fail validation, so every id used
// as TOOL INPUT (never mock return values, which aren't re-validated) is a
// real generated UUID.
const CUST_ID = randomUUID();
const LEAD_ID = randomUUID();
const JOB_ID = randomUUID();

function fakeCtx(overrides: Partial<AiToolContext> = {}): AiToolContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeFakeSupabase({}) as any,
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

describe("Phase 4 AI write tools (spec section 14/15/19/24)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers every expected write tool with permission: write", () => {
    const writeNames = [
      "create_customer",
      "create_lead",
      "update_lead",
      "create_task",
      "add_conversation_event",
      "update_conversation_state",
    ];
    for (const name of writeNames) {
      const tool = getRegisteredTools().find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool?.permission).toBe("write");
    }
  });

  describe("find_customer_by_contact", () => {
    it("rejects a call with neither phone nor email", async () => {
      await expect(executeTool(fakeCtx(), "find_customer_by_contact", {})).rejects.toBeInstanceOf(
        AiValidationError
      );
      expect(findCustomerByContact).not.toHaveBeenCalled();
    });

    it("passes through zero, one, or many matches without picking one itself", async () => {
      findCustomerByContact.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
      const result = await executeTool(fakeCtx(), "find_customer_by_contact", { phone: "+254700000000" });
      expect(result).toHaveLength(2);
    });
  });

  describe("create_customer", () => {
    it("rejects a name shorter than 2 characters", async () => {
      await expect(executeTool(fakeCtx(), "create_customer", { fullName: "J" })).rejects.toBeInstanceOf(
        AiValidationError
      );
      expect(createCustomer).not.toHaveBeenCalled();
    });

    it("creates a customer scoped to ctx.businessId, never a model-supplied business id", async () => {
      createCustomer.mockResolvedValue("new-cust-1");
      const result = (await executeTool(fakeCtx({ businessId: "biz-1" }), "create_customer", {
        fullName: "Jane Doe",
        businessId: "attacker-biz", // not part of the schema — must be silently ignored
      })) as { customerId: string };

      expect(result.customerId).toBe("new-cust-1");
      expect(createCustomer).toHaveBeenCalledWith(
        expect.anything(),
        "biz-1", // ctx.businessId, not the bogus one in the arguments
        "user-1",
        expect.objectContaining({ fullName: "Jane Doe" })
      );
    });
  });

  describe("create_lead", () => {
    it("does not create a duplicate lead for a customer who already has an active one", async () => {
      findActiveLeadForCustomer.mockResolvedValue({ id: "lead-existing", temperature: "warm", score: 50 });

      const result = (await executeTool(fakeCtx(), "create_lead", { customerId: CUST_ID })) as {
        created: boolean;
        leadId: string;
      };

      expect(result.created).toBe(false);
      expect(result.leadId).toBe("lead-existing");
      expect(createLead).not.toHaveBeenCalled();
    });

    it("computes score/temperature from qualification factors via the deterministic scoring function, never from a model-supplied number", async () => {
      findActiveLeadForCustomer.mockResolvedValue(null);
      createLead.mockResolvedValue("lead-new-1");

      const factors = { intentClarity: 0.9, fit: 0.8, urgency: 0.7, completeness: 0.6, engagement: 0.9, opportunityRelevance: 1 };
      const expected = recommendQualification(factors);

      await executeTool(fakeCtx(), "create_lead", { customerId: CUST_ID, qualification: factors });

      expect(createLead).toHaveBeenCalledWith(
        expect.anything(),
        "biz-1",
        "user-1",
        expect.objectContaining({ score: expected.score, temperature: expected.temperature })
      );
    });

    it("rejects a qualification factor outside the [0,1] range", async () => {
      await expect(
        executeTool(fakeCtx(), "create_lead", { customerId: CUST_ID, qualification: { intentClarity: 5 } })
      ).rejects.toBeInstanceOf(AiValidationError);
    });

    it("refuses to link a job that is no longer open, and does not create an application", async () => {
      findActiveLeadForCustomer.mockResolvedValue(null);
      createLead.mockResolvedValue("lead-new-1");
      getJob.mockResolvedValue({ id: JOB_ID, title: "Nurse - Qatar", effectiveStatus: "closed" });

      await expect(
        executeTool(fakeCtx(), "create_lead", { customerId: CUST_ID, opportunityId: JOB_ID })
      ).rejects.toThrow(/no longer open/i);
      expect(createApplication).not.toHaveBeenCalled();
    });

    it("links to an open job by creating an application", async () => {
      findActiveLeadForCustomer.mockResolvedValue(null);
      createLead.mockResolvedValue("lead-new-1");
      getJob.mockResolvedValue({ id: JOB_ID, title: "Nurse - Qatar", effectiveStatus: "open" });
      listApplications.mockResolvedValue([]);
      createApplication.mockResolvedValue("app-1");

      const result = (await executeTool(fakeCtx(), "create_lead", {
        customerId: CUST_ID,
        opportunityId: JOB_ID,
      })) as { applicationId: string | null };

      expect(result.applicationId).toBe("app-1");
      expect(createApplication).toHaveBeenCalledTimes(1);
    });

    // Live-testing follow-up: create_lead was failing with "Invalid UUID"
    // for a REAL customer/job because Zod's `.uuid()` also demanded RFC4122
    // version/variant nibbles that Phase 0's seed.sql demo rows don't have
    // (they use hand-typed, human-readable placeholder ids like
    // "00000000-0000-0000-0000-000000000101" — the real "[DEMO] Registered
    // Nurse — Luxembourg" job's actual id). These are entirely valid
    // Postgres `uuid` values; the fix (`.guid()` — see
    // src/lib/ai/validation.ts's `dbId()`) accepts them while still
    // rejecting anything that isn't UUID-shaped at all.
    it("accepts a hand-seeded, non-RFC4122 placeholder-style customerId and opportunityId (e.g. seed.sql's demo rows) — this is the exact live failure this fixes", async () => {
      const seedStyleCustomerId = "00000000-0000-0000-0000-000000000201";
      const seedStyleJobId = "00000000-0000-0000-0000-000000000101";
      findActiveLeadForCustomer.mockResolvedValue(null);
      createLead.mockResolvedValue("lead-new-1");
      getJob.mockResolvedValue({ id: seedStyleJobId, title: "[DEMO] Registered Nurse — Luxembourg", effectiveStatus: "open" });
      listApplications.mockResolvedValue([]);
      createApplication.mockResolvedValue("app-1");

      const result = (await executeTool(fakeCtx(), "create_lead", {
        customerId: seedStyleCustomerId,
        opportunityId: seedStyleJobId,
      })) as { applicationId: string | null };

      expect(result.applicationId).toBe("app-1");
      expect(createLead).toHaveBeenCalledWith(
        expect.anything(),
        "biz-1",
        "user-1",
        expect.objectContaining({ customerId: seedStyleCustomerId })
      );
    });

    it("still rejects a string that isn't UUID-shaped at all as customerId — a name, phone, email, or job title is never accepted in place of a real id", async () => {
      for (const notAnId of ["Victor Test", "+254712345678", "victor@example.com", "[DEMO] Registered Nurse — Luxembourg", "not-a-uuid"]) {
        await expect(executeTool(fakeCtx(), "create_lead", { customerId: notAnId })).rejects.toBeInstanceOf(
          AiValidationError
        );
      }
      expect(createLead).not.toHaveBeenCalled();
    });

    it("still rejects a non-UUID-shaped opportunityId the same way", async () => {
      findActiveLeadForCustomer.mockResolvedValue(null);
      await expect(
        executeTool(fakeCtx(), "create_lead", { customerId: CUST_ID, opportunityId: "[DEMO] Registered Nurse — Luxembourg" })
      ).rejects.toBeInstanceOf(AiValidationError);
      expect(getJob).not.toHaveBeenCalled();
    });
  });

  describe("update_lead", () => {
    it("never accepts a raw temperature or score directly — only qualification factors", async () => {
      const tool = getRegisteredTools().find((t) => t.name === "update_lead")!;
      const shape = JSON.stringify(tool.inputSchema);
      // The Zod schema object itself has no top-level temperature/score keys.
      const parsed = tool.inputSchema.safeParse({ leadId: LEAD_ID, temperature: "hot", score: 100 });
      expect(parsed.success).toBe(true);
      // Extra keys are stripped by Zod's default (non-strict) object parsing —
      // they never reach updateLeadPipeline.
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty("temperature");
        expect(parsed.data).not.toHaveProperty("score");
      }
      expect(shape).toBeTruthy();
    });

    it("recomputes temperature/score from factors rather than trusting any client value", async () => {
      getLead.mockResolvedValue({ id: LEAD_ID, stage: "new", temperature: "nurture", score: 0 });
      const factors = { intentClarity: 1, fit: 1, urgency: 1, completeness: 1, engagement: 1, opportunityRelevance: 1 };

      await executeTool(fakeCtx(), "update_lead", {
        leadId: LEAD_ID,
        qualification: factors,
      });

      expect(updateLeadPipeline).toHaveBeenCalledWith(
        expect.anything(),
        LEAD_ID,
        "user-1",
        expect.objectContaining({ score: 100, temperature: "hot" })
      );
    });

    it("rejects a malformed lead id", async () => {
      await expect(executeTool(fakeCtx(), "update_lead", { leadId: "not-a-uuid" })).rejects.toBeInstanceOf(
        AiValidationError
      );
    });
  });

  describe("add_conversation_event / update_conversation_state — conversation scoping", () => {
    it("refuses to run outside an active conversation (ctx.conversationId is null)", async () => {
      await expect(
        executeTool(fakeCtx({ conversationId: null }), "add_conversation_event", { eventType: "intent_detected" })
      ).rejects.toBeInstanceOf(AiToolError);
      await expect(
        executeTool(fakeCtx({ conversationId: null }), "update_conversation_state", { intent: "JOB_ENQUIRY" })
      ).rejects.toBeInstanceOf(AiToolError);
    });

    it("rejects an intent outside the documented SALES_INTENTS set", async () => {
      await expect(
        executeTool(fakeCtx({ conversationId: "conv-1" }), "update_conversation_state", { intent: "MADE_UP_INTENT" })
      ).rejects.toBeInstanceOf(AiValidationError);
    });

    it("refuses to let the AI set mode back to 'ai' itself — only a human takeover action can", async () => {
      getConversationState.mockResolvedValue({ mode: "human", intent: null, matchedOpportunityId: null });
      await expect(
        executeTool(fakeCtx({ conversationId: "conv-1" }), "update_conversation_state", { mode: "ai" })
      ).rejects.toThrow(/cannot resume itself/i);
      expect(updateConversationState).not.toHaveBeenCalled();
    });

    it("re-verifies a job is still open before storing it as the matched opportunity", async () => {
      getConversationState.mockResolvedValue({ mode: "ai", intent: null, matchedOpportunityId: null });
      getJob.mockResolvedValue({ id: JOB_ID, title: "Nurse - Qatar", effectiveStatus: "expired" });

      await expect(
        executeTool(fakeCtx({ conversationId: "conv-1" }), "update_conversation_state", {
          matchedOpportunityId: JOB_ID,
        })
      ).rejects.toThrow(/no longer open/i);
      expect(updateConversationState).not.toHaveBeenCalled();
    });

    it("records a conversation event with a payload of only safe primitive values", async () => {
      await executeTool(fakeCtx({ conversationId: "conv-1" }), "add_conversation_event", {
        eventType: "follow_up_required",
        payload: { taskId: "task-1", urgent: true, count: 3 },
      });
      expect(logConversationEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ conversationId: "conv-1", eventType: "follow_up_required" })
      );
    });

    it("rejects a non-primitive (nested object/array) payload value", async () => {
      await expect(
        executeTool(fakeCtx({ conversationId: "conv-1" }), "add_conversation_event", {
          eventType: "follow_up_required",
          payload: { nested: { a: 1 } },
        })
      ).rejects.toBeInstanceOf(AiValidationError);
    });
  });

  describe("create_task", () => {
    it("always creates the task as pending, owned by the current user — never a status the model chooses", async () => {
      createTask.mockResolvedValue("task-1");
      await executeTool(fakeCtx({ userId: "staff-1" }), "create_task", { title: "Call back tomorrow" });
      expect(createTask).toHaveBeenCalledWith(
        expect.anything(),
        "biz-1",
        "staff-1",
        expect.objectContaining({ status: "pending", title: "Call back tomorrow" })
      );
    });
  });
});

import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiToolDefinition } from "../types";
import { AiToolError } from "../errors";
import { findCustomerByContact, createCustomer } from "@/lib/business/customers";
import { createLead, updateLeadPipeline, addLeadNote, findActiveLeadForCustomer, getLead as getLeadById } from "@/lib/business/leads";
import { createApplication, listApplications } from "@/lib/business/applications";
import { getJob as getJobById } from "@/lib/business/jobs";
import { createTask } from "@/lib/business/tasks";
import {
  updateConversationState as updateConversationStateRow,
  getConversationState,
} from "@/lib/business/conversations";
import { logConversationEvent, CONVERSATION_EVENT_TYPES } from "@/lib/business/conversation-events";
import { recommendQualification, type QualificationFactors } from "../qualification/scoring";
import { SALES_INTENTS } from "../sales/intents";
import { dbId } from "../validation";

/**
 * Phase 4's carefully controlled WRITE tools (spec section 14). Same rules
 * as src/lib/ai/tools/read-only.ts, restated because they matter most here:
 *   - No tool ever takes a `businessId`/`business_id` input — scope always
 *     comes from `ctx.businessId`. Enforced structurally and by
 *     registry.test.ts's schema scan, which now covers these tools too.
 *   - No tool ever takes a `conversationId` input either, for the same
 *     reason — it comes from `ctx.conversationId`, set server-side by the
 *     AI Sales Agent route, never from the model.
 *   - Every handler runs through the same RLS-scoped `ctx.supabase` client.
 *   - Every write wraps an EXISTING business-logic function
 *     (createCustomer, createLead, updateLeadPipeline, createTask,
 *     createApplication) that already does its own audit logging — nothing
 *     here talks to a table directly except the two genuinely new
 *     Phase 4 tables (conversation state / conversation_events).
 *   - Score/temperature are never accepted directly from the model — only
 *     qualification FACTORS, run through the documented, deterministic
 *     scoring function in ../qualification/scoring.ts. The model estimates
 *     factors from the conversation; the application computes the number.
 *   - Explicitly absent, by design (spec section 15): delete_*, any
 *     payment/refund tool, update_application_status, approve/reject
 *     applicant, close_job, publish_*, send_whatsapp/send_email. None of
 *     these exist anywhere in this registry.
 */

async function safeRun<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiToolError) throw err;
    console.error(`[ai:tool:${toolName}] failed`, err);
    throw new AiToolError(toolName, `Couldn't complete "${toolName}" right now — please try again.`, { cause: err });
  }
}

function requireConversation(ctx: { conversationId: string | null }, toolName: string): string {
  if (!ctx.conversationId) {
    throw new AiToolError(
      toolName,
      `The "${toolName}" tool is only available inside an active customer conversation.`
    );
  }
  return ctx.conversationId;
}

/** Re-checks a job's LIVE effective status right before it's linked/recommended (spec section 11, critical). */
async function assertJobIsOpen(
  supabase: SupabaseClient,
  toolName: string,
  jobId: string
): Promise<{ id: string; title: string }> {
  const job = await getJobById(supabase, jobId);
  if (!job) throw new AiToolError(toolName, "That job no longer exists.");
  if (job.effectiveStatus !== "open") {
    throw new AiToolError(
      toolName,
      `"${job.title}" is no longer open (status: ${job.effectiveStatus}) — search for currently open jobs before recommending or linking one.`
    );
  }
  return { id: job.id, title: job.title };
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

// -----------------------------------------------------------------------------
// Customer identification
// -----------------------------------------------------------------------------

const findCustomerByContactInput = z
  .object({
    phone: optionalText(40),
    email: z.string().trim().email().optional(),
  })
  .refine((v) => v.phone || v.email, { message: "Provide a phone number or an email address to search by." });

const findCustomerByContactTool: AiToolDefinition<z.infer<typeof findCustomerByContactInput>> = {
  name: "find_customer_by_contact",
  description:
    "Find existing customers by an EXACT phone or email match, before deciding whether to create a new customer or reuse one. Returns zero, one, or multiple matches — multiple matches means the identity is ambiguous and you should ask the customer to confirm rather than guessing (spec: never merge/guess on ambiguous identity).",
  inputSchema: findCustomerByContactInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("find_customer_by_contact", () =>
      findCustomerByContact(ctx.supabase, ctx.businessId, { phone: input.phone, email: input.email })
    ),
};

const createCustomerInput = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters."),
  phone: optionalText(40),
  email: z.string().trim().email().optional(),
  country: optionalText(100),
  profession: optionalText(150),
  notes: optionalText(2000),
});

const createCustomerTool: AiToolDefinition<z.infer<typeof createCustomerInput>> = {
  name: "create_customer",
  description:
    "Create a new customer record. Only use this AFTER find_customer_by_contact shows no existing match for this person's phone/email — never create a duplicate customer for someone who already exists.",
  inputSchema: createCustomerInput,
  permission: "write",
  handler: (ctx, input) =>
    safeRun("create_customer", async () => {
      const customerId = await createCustomer(ctx.supabase, ctx.businessId, ctx.userId, {
        fullName: input.fullName,
        phone: input.phone ?? "",
        email: input.email ?? "",
        country: input.country ?? "",
        profession: input.profession ?? "",
        notes: input.notes ?? "",
      });
      return { created: true, customerId, fullName: input.fullName };
    }),
};

// -----------------------------------------------------------------------------
// Leads
// -----------------------------------------------------------------------------

const qualificationFactorsSchema = z
  .object({
    intentClarity: z.number().min(0).max(1).optional(),
    fit: z.number().min(0).max(1).optional(),
    urgency: z.number().min(0).max(1).optional(),
    completeness: z.number().min(0).max(1).optional(),
    engagement: z.number().min(0).max(1).optional(),
    opportunityRelevance: z.number().min(0).max(1).optional(),
  })
  .describe(
    "Your best estimate (0 = no evidence, 1 = strong evidence) of each qualification factor from the conversation so far. The application computes the actual lead score/temperature from these — you never set a score or temperature number directly."
  );

const createLeadInput = z.object({
  // dbId(), not z.string().uuid() — this must accept ANY real customer id,
  // including seed data's hand-typed placeholder ids (e.g. the [DEMO]
  // customers/jobs from supabase/seed.sql), which are valid Postgres uuid
  // values but fail Zod's stricter RFC4122 version-nibble check. See
  // dbId()'s doc comment in src/lib/ai/validation.ts for the full story —
  // this was rejecting genuine tool results as "Invalid UUID".
  customerId: dbId().describe("The customer this lead belongs to (from find_customer_by_contact or create_customer)."),
  service: optionalText(200).describe("What the customer is interested in, e.g. \"Registered Nurse - Jobs Abroad\"."),
  targetCountry: optionalText(100),
  source: optionalText(100).describe("Where this lead came from, e.g. \"website\", \"ai_sales_agent\"."),
  opportunityId: dbId()
    .optional()
    .describe("A specific OPEN job this lead is interested in — will be re-verified as currently open before linking."),
  qualification: qualificationFactorsSchema.optional(),
});

const createLeadTool: AiToolDefinition<z.infer<typeof createLeadInput>> = {
  name: "create_lead",
  description:
    "Create (or reuse, if one already exists) a CRM lead for a customer. If opportunityId is given, also creates an application linking the lead to that job — but only if the job is currently open. Never creates a second lead for a customer who already has an active one; returns the existing lead instead.",
  inputSchema: createLeadInput,
  permission: "write",
  handler: (ctx, input) =>
    safeRun("create_lead", async () => {
      const existing = await findActiveLeadForCustomer(ctx.supabase, input.customerId);

      let leadId: string;
      let created: boolean;
      let temperature: "hot" | "warm" | "nurture" = "nurture";
      let score = 0;

      if (existing) {
        leadId = existing.id;
        created = false;
        temperature = existing.temperature;
        score = existing.score;
      } else {
        const recommendation = input.qualification
          ? recommendQualification(input.qualification as Partial<QualificationFactors>)
          : recommendQualification({});
        temperature = recommendation.temperature;
        score = recommendation.score;

        leadId = await createLead(ctx.supabase, ctx.businessId, ctx.userId, {
          customerId: input.customerId,
          service: input.service ?? "",
          targetCountry: input.targetCountry ?? "",
          source: input.source || "ai_sales_agent",
          stage: "new",
          score,
          temperature,
          assignedTo: "",
        });
        created = true;
      }

      let applicationId: string | null = null;
      let jobTitle: string | null = null;
      if (input.opportunityId) {
        const job = await assertJobIsOpen(ctx.supabase, "create_lead", input.opportunityId);
        jobTitle = job.title;

        const existingApplications = await listApplications(ctx.supabase, ctx.businessId, {
          leadId,
          opportunityId: input.opportunityId,
        });
        if (existingApplications.length > 0) {
          applicationId = existingApplications[0].id;
        } else {
          applicationId = await createApplication(ctx.supabase, ctx.businessId, ctx.userId, {
            customerId: input.customerId,
            leadId,
            opportunityId: input.opportunityId,
            status: "new",
            notes: "",
          });
        }
      }

      if (ctx.conversationId) {
        await updateConversationStateRow(
          ctx.supabase,
          ctx.conversationId,
          { id: null, type: "ai" },
          { leadId, customerId: input.customerId, matchedOpportunityId: input.opportunityId ?? undefined }
        );
        await logConversationEvent(ctx.supabase, {
          conversationId: ctx.conversationId,
          eventType: created ? "lead_created" : "lead_updated",
          payload: { leadId, opportunityId: input.opportunityId ?? null },
        });
        if (input.opportunityId) {
          await logConversationEvent(ctx.supabase, {
            conversationId: ctx.conversationId,
            eventType: "opportunity_matched",
            payload: { opportunityId: input.opportunityId, jobTitle },
          });
        }
      }

      return { created, leadId, temperature, score, applicationId, jobTitle };
    }),
};

const updateLeadInput = z.object({
  leadId: dbId(),
  stage: optionalText(50).describe("Pipeline stage key, e.g. \"contacted\", \"qualified\", \"documents\"."),
  note: optionalText(5000).describe("A note to add to this lead's timeline."),
  qualification: qualificationFactorsSchema.optional().describe(
    "Updated qualification factors — if given, the lead's score/temperature are recomputed from these (never set directly)."
  ),
});

const updateLeadTool: AiToolDefinition<z.infer<typeof updateLeadInput>> = {
  name: "update_lead",
  description:
    "Update an existing lead's pipeline stage and/or qualification. Score and temperature are always recomputed by the application from the qualification factors you provide — you cannot set them directly. Every change is recorded on the lead's timeline.",
  inputSchema: updateLeadInput,
  permission: "write",
  handler: (ctx, input) =>
    safeRun("update_lead", async () => {
      const existing = await getLeadById(ctx.supabase, input.leadId);
      if (!existing) throw new AiToolError("update_lead", "No lead found with that id.");

      const changes: { stage?: string; score?: number; temperature?: "hot" | "warm" | "nurture" } = {};
      if (input.stage) changes.stage = input.stage;

      let recommendation: ReturnType<typeof recommendQualification> | null = null;
      if (input.qualification) {
        recommendation = recommendQualification(input.qualification as Partial<QualificationFactors>);
        changes.score = recommendation.score;
        changes.temperature = recommendation.temperature;
      }

      await updateLeadPipeline(ctx.supabase, input.leadId, ctx.userId, changes);
      if (input.note) {
        await addLeadNote(ctx.supabase, input.leadId, ctx.userId, input.note);
      }

      if (ctx.conversationId) {
        await logConversationEvent(ctx.supabase, {
          conversationId: ctx.conversationId,
          eventType: "lead_updated",
          payload: { leadId: input.leadId, ...changes },
        });
      }

      return {
        leadId: input.leadId,
        stage: changes.stage ?? existing.stage,
        temperature: changes.temperature ?? existing.temperature,
        score: changes.score ?? existing.score,
      };
    }),
};

// -----------------------------------------------------------------------------
// Tasks
// -----------------------------------------------------------------------------

const createTaskInput = z.object({
  title: z.string().trim().min(2, "Give the task a title."),
  description: optionalText(2000),
  dueDate: optionalText(40).describe("ISO date/time string, if there's a specific follow-up date."),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  relatedCustomerId: dbId().optional(),
  relatedLeadId: dbId().optional(),
  relatedOpportunityId: dbId().optional(),
  notes: optionalText(2000),
});

const createTaskTool: AiToolDefinition<z.infer<typeof createTaskInput>> = {
  name: "create_task",
  description:
    "Create a follow-up task for staff, e.g. \"Call back about visa documents\" or \"Send job details for Somalia physiotherapy role\". Always created with status pending, owned by the staff member running this conversation.",
  inputSchema: createTaskInput,
  permission: "write",
  handler: (ctx, input) =>
    safeRun("create_task", async () => {
      const taskId = await createTask(ctx.supabase, ctx.businessId, ctx.userId, {
        title: input.title,
        description: input.description ?? "",
        dueDate: input.dueDate ?? "",
        priority: input.priority ?? "medium",
        status: "pending",
        relatedCustomerId: input.relatedCustomerId ?? "",
        relatedLeadId: input.relatedLeadId ?? "",
        relatedOpportunityId: input.relatedOpportunityId ?? "",
        notes: input.notes ?? "",
      });

      if (ctx.conversationId) {
        await logConversationEvent(ctx.supabase, {
          conversationId: ctx.conversationId,
          eventType: "follow_up_required",
          payload: { taskId, title: input.title },
        });
      }

      return { taskId, title: input.title };
    }),
};

// -----------------------------------------------------------------------------
// Conversation state
// -----------------------------------------------------------------------------

const addConversationEventInput = z.object({
  eventType: z.enum(CONVERSATION_EVENT_TYPES),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const addConversationEventTool: AiToolDefinition<z.infer<typeof addConversationEventInput>> = {
  name: "add_conversation_event",
  description: `Record a structured event on THIS conversation's timeline for analytics/follow-up (one of: ${CONVERSATION_EVENT_TYPES.join(", ")}). Use this for things worth tracking that aren't a lead/task change, e.g. when qualification starts or completes.`,
  inputSchema: addConversationEventInput,
  permission: "write",
  handler: (ctx, input) =>
    safeRun("add_conversation_event", async () => {
      const conversationId = requireConversation(ctx, "add_conversation_event");
      await logConversationEvent(ctx.supabase, {
        conversationId,
        eventType: input.eventType,
        payload: input.payload ?? {},
      });
      return { recorded: true, eventType: input.eventType };
    }),
};

const qualificationDataSchema = z
  .object({
    serviceInterest: optionalText(200),
    destination: optionalText(100),
    travelDates: optionalText(100),
    budget: optionalText(100),
    experienceLevel: optionalText(200),
    urgency: z.enum(["low", "medium", "high"]).optional(),
    preferredContactMethod: z.enum(["phone", "whatsapp", "email", "any"]).optional(),
    notes: optionalText(1000),
  })
  .describe("Allow-listed qualification fields captured from the conversation — merged into what's already known, never replacing it wholesale.");

const updateConversationStateInput = z.object({
  mode: z.enum(["ai", "human", "paused"]).optional().describe("Only set to \"human\" or \"paused\" — the AI should never set itself back to \"ai\" (a human resumes it)."),
  handoverReason: optionalText(500),
  intent: z.enum(SALES_INTENTS).optional(),
  matchedOpportunityId: dbId()
    .optional()
    .describe("A specific job this conversation is about — re-verified as currently open before being stored."),
  qualification: qualificationDataSchema.optional(),
});

const updateConversationStateTool: AiToolDefinition<z.infer<typeof updateConversationStateInput>> = {
  name: "update_conversation_state",
  description:
    "Update THIS conversation's structured state: detected intent, matched job, captured qualification details, or hand the conversation to a human (mode: \"human\") when you can't help or the customer asks for a person. You cannot set mode back to \"ai\" yourself.",
  inputSchema: updateConversationStateInput,
  permission: "write",
  handler: (ctx, input) =>
    safeRun("update_conversation_state", async () => {
      const conversationId = requireConversation(ctx, "update_conversation_state");

      if (input.mode === "ai") {
        throw new AiToolError(
          "update_conversation_state",
          "The AI cannot resume itself from human/paused mode — a staff member must do that."
        );
      }

      const before = await getConversationState(ctx.supabase, conversationId);

      let jobTitle: string | null = null;
      if (input.matchedOpportunityId) {
        const job = await assertJobIsOpen(ctx.supabase, "update_conversation_state", input.matchedOpportunityId);
        jobTitle = job.title;
      }

      const updated = await updateConversationStateRow(ctx.supabase, conversationId, { id: null, type: "ai" }, {
        mode: input.mode,
        handoverReason: input.handoverReason,
        intent: input.intent,
        matchedOpportunityId: input.matchedOpportunityId,
        qualification: input.qualification as Record<string, unknown> | undefined,
      });

      if (input.intent && input.intent !== before?.intent) {
        await logConversationEvent(ctx.supabase, {
          conversationId,
          eventType: "intent_detected",
          payload: { intent: input.intent },
        });
      }
      if (input.matchedOpportunityId && input.matchedOpportunityId !== before?.matchedOpportunityId) {
        await logConversationEvent(ctx.supabase, {
          conversationId,
          eventType: "opportunity_matched",
          payload: { opportunityId: input.matchedOpportunityId, jobTitle },
        });
      }

      return {
        mode: updated.mode,
        intent: updated.intent,
        matchedOpportunityId: updated.matchedOpportunityId,
        qualification: updated.qualification,
      };
    }),
};

/** Every WRITE tool the AI Core can call in Phase 4 (spec section 14). */
export const WRITE_TOOLS: AiToolDefinition<never, unknown>[] = [
  findCustomerByContactTool,
  createCustomerTool,
  createLeadTool,
  updateLeadTool,
  createTaskTool,
  addConversationEventTool,
  updateConversationStateTool,
] as unknown as AiToolDefinition<never, unknown>[];

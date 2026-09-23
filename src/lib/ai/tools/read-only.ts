import "server-only";
import { z } from "zod";
import type { AiToolDefinition } from "../types";
import { AiToolError } from "../errors";
import { getDashboardOverview } from "@/lib/business/dashboard";
import { listCustomers, getCustomer as getCustomerById } from "@/lib/business/customers";
import { listLeads, getLead as getLeadById } from "@/lib/business/leads";
import {
  listJobs,
  getJob as getJobById,
  getJobsSummary,
  type JobStatus,
} from "@/lib/business/jobs";
import { listApplications, getApplication as getApplicationById } from "@/lib/business/applications";
import { getApplicationDocumentChecklist } from "@/lib/business/job-documents";
import { listTasks } from "@/lib/business/tasks";
import { listNotifications } from "@/lib/business/notifications";
import { listRecentActivity } from "@/lib/business/audit";
import { getBusinessSettings } from "@/lib/business/settings";
import { searchKnowledgeItems } from "@/lib/business/knowledge";
import { applicationStatusValues, jobStatusValues } from "@/lib/business/validation";
import { dbId } from "../validation";

/**
 * Every read-only business tool the AI Core can call (spec section 4).
 *
 * Design rules, enforced here and checked by src/lib/ai/tools/registry.test.ts:
 *   - No tool ever takes a `businessId`/`business_id` input. Business scope
 *     always comes from `ctx.businessId` (resolved server-side from the
 *     authenticated session — see src/lib/ai/context.ts), never from the
 *     model. This means the model cannot even ATTEMPT to ask for another
 *     business's data through a tool argument.
 *   - Every handler runs through `ctx.supabase` — the same RLS-scoped
 *     client (authenticated as the real signed-in user) every page and
 *     Server Action already uses. Row Level Security is the actual
 *     enforcement boundary, exactly like the rest of the app
 *     (ARCHITECTURE.md section 6) — these tools add explicit
 *     `business_id` filters on top as defense in depth, never as a
 *     replacement for RLS.
 *   - Every handler wraps its business-logic call in try/catch and rethrows
 *     an AiToolError with a short, safe message — a raw Postgres/Supabase
 *     error never reaches the model or the user.
 *   - Nothing here writes, deletes, sends, or publishes anything. There is
 *     no `execute_sql` tool and never will be one at this permission level.
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

const empty = z.object({}).describe("No arguments.");

// -----------------------------------------------------------------------------
// Dashboard / business summary
// -----------------------------------------------------------------------------

const getDashboardSummary: AiToolDefinition<Record<string, never>> = {
  name: "get_dashboard_summary",
  description:
    "Get today's operational overview: new leads, hot/warm leads, follow-ups due today, active applications, pending documents, payments due, content awaiting approval, and scheduled posts. Use this for \"what needs my attention today\" style questions.",
  inputSchema: empty,
  permission: "read",
  handler: (ctx) =>
    safeRun("get_dashboard_summary", async () => {
      const { data, error } = await getDashboardOverview(ctx.supabase);
      if (error) throw new AiToolError("get_dashboard_summary", error);
      return data;
    }),
};

const getBusinessSummary: AiToolDefinition<Record<string, never>> = {
  name: "get_business_summary",
  description:
    "Get a high-level snapshot of the whole business: name, active modules, and totals (customers, leads, hot leads, jobs, open jobs, applications). Use this for broad \"how is the business doing\" style questions, not for today's to-do list (use get_dashboard_summary for that).",
  inputSchema: empty,
  permission: "read",
  handler: (ctx) =>
    safeRun("get_business_summary", async () => {
      const [customers, leads, hotLeads, jobsSummary] = await Promise.all([
        ctx.supabase.from("customers").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId),
        ctx.supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId),
        ctx.supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("business_id", ctx.businessId)
          .eq("temperature", "hot"),
        getJobsSummary(ctx.supabase, ctx.businessId),
      ]);
      return {
        businessName: ctx.businessName,
        totalCustomers: customers.count ?? 0,
        totalLeads: leads.count ?? 0,
        hotLeads: hotLeads.count ?? 0,
        ...jobsSummary,
      };
    }),
};

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

const searchCustomersInput = z.object({
  search: z.string().trim().max(200).optional().describe("Free-text search over name, phone, or email."),
});

const searchCustomers: AiToolDefinition<z.infer<typeof searchCustomersInput>> = {
  name: "search_customers",
  description: "Search customers by name, phone, or email. Omit the search term to list recent customers.",
  inputSchema: searchCustomersInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("search_customers", () => listCustomers(ctx.supabase, ctx.businessId, { search: input.search })),
};

const getCustomerInput = z.object({
  // dbId(), not z.string().uuid() — see its doc comment in
  // src/lib/ai/validation.ts. A real customer id, including seed data's
  // hand-typed placeholder ids, must never be rejected as "Invalid UUID".
  customerId: dbId().describe("The customer's UUID (from a prior search_customers result)."),
});

const getCustomer: AiToolDefinition<z.infer<typeof getCustomerInput>> = {
  name: "get_customer",
  description: "Get full detail for one customer by id, including their notes and lead count.",
  inputSchema: getCustomerInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_customer", async () => {
      const customer = await getCustomerById(ctx.supabase, input.customerId);
      if (!customer) throw new AiToolError("get_customer", "No customer found with that id.");
      return customer;
    }),
};

// -----------------------------------------------------------------------------
// Leads
// -----------------------------------------------------------------------------

const searchLeadsInput = z.object({
  stage: z.string().trim().max(50).optional().describe("Pipeline stage key, e.g. \"new\", \"documents\", \"submitted\"."),
  temperature: z.enum(["hot", "warm", "nurture"]).optional(),
  search: z.string().trim().max(200).optional().describe("Free-text search over customer name, service, or target country."),
  activeOnly: z.boolean().optional().describe("Set true to exclude closed/inactive leads."),
});

const searchLeads: AiToolDefinition<z.infer<typeof searchLeadsInput>> = {
  name: "search_leads",
  description: "Search/filter leads by pipeline stage, temperature (hot/warm/nurture), or free text.",
  inputSchema: searchLeadsInput,
  permission: "read",
  handler: (ctx, input) => safeRun("search_leads", () => listLeads(ctx.supabase, ctx.businessId, input)),
};

const getLeadInput = z.object({
  leadId: dbId().describe("The lead's UUID (from a prior search_leads result)."),
});

const getLead: AiToolDefinition<z.infer<typeof getLeadInput>> = {
  name: "get_lead",
  description: "Get full detail for one lead by id.",
  inputSchema: getLeadInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_lead", async () => {
      const lead = await getLeadById(ctx.supabase, input.leadId);
      if (!lead) throw new AiToolError("get_lead", "No lead found with that id.");
      return lead;
    }),
};

const getHotLeadsInput = z.object({
  limit: z.number().int().min(1).max(50).optional().describe("Max number of hot leads to return (default 20)."),
});

const getHotLeads: AiToolDefinition<z.infer<typeof getHotLeadsInput>> = {
  name: "get_hot_leads",
  description: "List the business's current hot leads (temperature = hot), most recent first.",
  inputSchema: getHotLeadsInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_hot_leads", async () => {
      const leads = await listLeads(ctx.supabase, ctx.businessId, { temperature: "hot", activeOnly: true });
      return leads.slice(0, input.limit ?? 20);
    }),
};

// -----------------------------------------------------------------------------
// Jobs
// -----------------------------------------------------------------------------

const getOpenJobsInput = z.object({
  country: z.string().trim().max(100).optional(),
  category: z.string().trim().max(150).optional(),
  search: z.string().trim().max(200).optional(),
});

const getOpenJobs: AiToolDefinition<z.infer<typeof getOpenJobsInput>> = {
  name: "get_open_jobs",
  description:
    "List jobs that are CURRENTLY open for applications — this checks each job's real effective status (accounting for expiry), never just the stored status field, so an expired job is never reported as open.",
  inputSchema: getOpenJobsInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_open_jobs", async () => {
      const jobs = await listJobs(ctx.supabase, ctx.businessId, {
        country: input.country,
        category: input.category,
        search: input.search,
      });
      return jobs.filter((j) => j.effectiveStatus === "open");
    }),
};

const getJobInput = z.object({
  jobId: dbId().describe("The job's UUID (from a prior get_open_jobs/search result)."),
});

const getJob: AiToolDefinition<z.infer<typeof getJobInput>> = {
  name: "get_job",
  description: "Get full detail for one job by id, including requirements, benefits, and status.",
  inputSchema: getJobInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_job", async () => {
      const job = await getJobById(ctx.supabase, input.jobId);
      if (!job) throw new AiToolError("get_job", "No job found with that id.");
      return job;
    }),
};

const getJobApplicantsInput = z.object({
  jobId: dbId().describe("The job's UUID to list applicants for."),
});

const getJobApplicants: AiToolDefinition<z.infer<typeof getJobApplicantsInput>> = {
  name: "get_job_applicants",
  description: "List every applicant (application) currently linked to one job.",
  inputSchema: getJobApplicantsInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_job_applicants", () =>
      listApplications(ctx.supabase, ctx.businessId, { opportunityId: input.jobId })
    ),
};

const getApplicationInput = z.object({
  applicationId: dbId(),
});

const getApplication: AiToolDefinition<z.infer<typeof getApplicationInput>> = {
  name: "get_application",
  description: `Get full detail for one application by id, including its recruitment pipeline status (one of: ${applicationStatusValues.join(", ")}).`,
  inputSchema: getApplicationInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_application", async () => {
      const application = await getApplicationById(ctx.supabase, input.applicationId);
      if (!application) throw new AiToolError("get_application", "No application found with that id.");
      return application;
    }),
};

const getMissingDocumentsInput = z.object({
  jobId: dbId().optional().describe("Limit to applicants for one specific job. Omit to check across all jobs."),
  limit: z.number().int().min(1).max(50).optional().describe("Max number of applicants to check (default 25, for cost control)."),
});

const getMissingDocuments: AiToolDefinition<z.infer<typeof getMissingDocumentsInput>> = {
  name: "get_missing_documents",
  description:
    "List applicants who are missing at least one MANDATORY document for the job they applied to — the same Required/Submitted/Missing checklist shown on each job's applicant list.",
  inputSchema: getMissingDocumentsInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_missing_documents", async () => {
      const applications = await listApplications(ctx.supabase, ctx.businessId, {
        opportunityId: input.jobId,
      });
      const jobApplications = applications.filter((a) => a.opportunityId).slice(0, input.limit ?? 25);

      const results: {
        applicationId: string;
        customerName: string;
        jobTitle: string | null;
        missingDocuments: string[];
      }[] = [];

      for (const app of jobApplications) {
        const checklist = await getApplicationDocumentChecklist(ctx.supabase, app.id);
        const missing = checklist.filter((c) => c.isMandatory && c.status === "missing").map((c) => c.documentType);
        if (missing.length > 0) {
          results.push({
            applicationId: app.id,
            customerName: app.customerName,
            jobTitle: app.opportunityTitle,
            missingDocuments: missing,
          });
        }
      }

      return results;
    }),
};

// -----------------------------------------------------------------------------
// Tasks / notifications / activity / settings / knowledge
// -----------------------------------------------------------------------------

const getTasksInput = z.object({
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
});

const getTasks: AiToolDefinition<z.infer<typeof getTasksInput>> = {
  name: "get_tasks",
  description: "List tasks, optionally filtered by status. Sorted by due date, soonest first.",
  inputSchema: getTasksInput,
  permission: "read",
  handler: (ctx, input) => safeRun("get_tasks", () => listTasks(ctx.supabase, ctx.businessId, { status: input.status })),
};

const getNotificationsInput = z.object({
  unreadOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const getNotifications: AiToolDefinition<z.infer<typeof getNotificationsInput>> = {
  name: "get_notifications",
  description: "List recent in-app notifications (e.g. hot lead alerts, new applications, job expiry).",
  inputSchema: getNotificationsInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_notifications", () =>
      listNotifications(ctx.supabase, ctx.businessId, { unreadOnly: input.unreadOnly, limit: input.limit })
    ),
};

const getRecentActivityInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  objectType: z.string().trim().max(50).optional().describe("Filter to one record type, e.g. \"lead\", \"opportunity\", \"application\"."),
});

const getRecentActivity: AiToolDefinition<z.infer<typeof getRecentActivityInput>> = {
  name: "get_recent_activity",
  description:
    "List recent recorded business activity from the audit log (creates, status changes, etc.) — use this for \"what's happened recently\" style questions.",
  inputSchema: getRecentActivityInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_recent_activity", () =>
      listRecentActivity(ctx.supabase, ctx.businessId, { limit: input.limit, objectType: input.objectType })
    ),
};

const getBusinessSettingsInput = z.object({
  category: z.string().trim().max(50).optional().describe("e.g. \"business\", \"ai\", \"notifications\"."),
});

const getBusinessSettingsTool: AiToolDefinition<z.infer<typeof getBusinessSettingsInput>> = {
  name: "get_business_settings",
  description: "Read non-secret business configuration key/value settings (never contains API keys or tokens).",
  inputSchema: getBusinessSettingsInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("get_business_settings", () => getBusinessSettings(ctx.supabase, ctx.businessId, { category: input.category })),
};

const searchKnowledgeBaseInput = z.object({
  search: z.string().trim().max(200).optional(),
  category: z
    .enum([
      "company_info",
      "services",
      "fees",
      "processes",
      "faqs",
      "job_opportunities",
      "visa_info",
      "safari_packages",
      "policies",
      "contact_info",
      "terms",
      "sales_scripts",
      "objection_handling",
      "marketing_guidelines",
    ])
    .optional(),
});

const searchKnowledgeBase: AiToolDefinition<z.infer<typeof searchKnowledgeBaseInput>> = {
  name: "search_knowledge_base",
  description:
    "Search the business's structured knowledge base (FAQs, fees, policies, processes, etc.) — use this before answering any question about company policy, fees, or standard process instead of guessing.",
  inputSchema: searchKnowledgeBaseInput,
  permission: "read",
  handler: (ctx, input) =>
    safeRun("search_knowledge_base", () =>
      searchKnowledgeItems(ctx.supabase, ctx.businessId, { search: input.search, category: input.category })
    ),
};

/** Every tool the AI Core can call in Phase 3 — all read-only (spec section 9). */
export const READ_ONLY_TOOLS: AiToolDefinition<never, unknown>[] = [
  getDashboardSummary,
  getBusinessSummary,
  searchCustomers,
  getCustomer,
  searchLeads,
  getLead,
  getHotLeads,
  getOpenJobs,
  getJob,
  getJobApplicants,
  getApplication,
  getMissingDocuments,
  getTasks,
  getNotifications,
  getRecentActivity,
  getBusinessSettingsTool,
  searchKnowledgeBase,
] as unknown as AiToolDefinition<never, unknown>[];

// Re-exported only so tests can reference the exact status enums without
// duplicating them — never used to build a second source of truth.
export const _jobStatusValues: readonly JobStatus[] = jobStatusValues;

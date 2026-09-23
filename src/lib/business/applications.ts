import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplicationInput } from "./validation";
import { logActivity } from "./audit";
import { logApplicationEvent } from "./application-events";
import { createNotification } from "./notifications";

export type ApplicationItem = {
  id: string;
  customerId: string;
  customerName: string;
  leadId: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  status: string;
  rejectionReason: string | null;
  notes: string | null;
  submittedAt: string | null;
  createdAt: string;
};

const APPLICATION_SELECT =
  "id, customer_id, lead_id, opportunity_id, status, rejection_reason, notes, submitted_at, created_at, customers:customer_id (full_name), opportunities:opportunity_id (title)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapApplication(row: any): ApplicationItem {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customers?.full_name ?? "Unknown customer",
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    opportunityTitle: row.opportunities?.title ?? null,
    status: row.status,
    rejectionReason: row.rejection_reason ?? null,
    notes: row.notes,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  };
}

export async function listApplications(
  supabase: SupabaseClient,
  businessId: string,
  opts: { customerId?: string; leadId?: string; opportunityId?: string } = {}
): Promise<ApplicationItem[]> {
  let query = supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  if (opts.leadId) query = query.eq("lead_id", opts.leadId);
  if (opts.opportunityId) query = query.eq("opportunity_id", opts.opportunityId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapApplication);
}

export async function getApplication(
  supabase: SupabaseClient,
  id: string
): Promise<ApplicationItem | null> {
  const { data, error } = await supabase.from("applications").select(APPLICATION_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapApplication(data);
}

/**
 * Statuses that mark a legacy-style "submission" moment, kept for the
 * `submitted_at` timestamp's original meaning (spec section 8 wants an
 * "application date").
 */
const SUBMITTED_STATUSES = new Set(["submitted_to_recruiter"]);

export async function createApplication(
  supabase: SupabaseClient,
  businessId: string,
  createdBy: string | null,
  input: ApplicationInput
): Promise<string> {
  const { data, error } = await supabase
    .from("applications")
    .insert({
      business_id: businessId,
      customer_id: input.customerId,
      lead_id: input.leadId || null,
      opportunity_id: input.opportunityId || null,
      status: input.status,
      notes: input.notes || null,
      submitted_at: SUBMITTED_STATUSES.has(input.status) ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw error;
  const applicationId = data.id as string;

  await logApplicationEvent(supabase, {
    applicationId,
    eventType: "created",
    payload: { status: input.status },
    createdBy,
  });

  await logActivity(supabase, {
    businessId,
    actorId: createdBy,
    // Phase 5F — see the identical comment in customers.ts's createCustomer.
    actorType: createdBy === null ? "system" : "user",
    action: "application.created",
    objectType: "application",
    objectId: applicationId,
  });

  // "New application" notification (spec section 15) — only when it's for a
  // specific job, so a general (no-opportunity) application tracker entry
  // doesn't spam the owner.
  if (input.opportunityId) {
    const [{ data: customer }, { data: job }] = await Promise.all([
      supabase.from("customers").select("full_name").eq("id", input.customerId).maybeSingle(),
      supabase.from("opportunities").select("title").eq("id", input.opportunityId).maybeSingle(),
    ]);
    await createNotification(supabase, {
      businessId,
      level: "normal",
      title: `New application: ${customer?.full_name ?? "A candidate"}`,
      body: job?.title ? `Applied for ${job.title}.` : undefined,
      relatedType: "application",
      relatedId: applicationId,
    });
  }

  return applicationId;
}

/** Status transitions that fire a notification (spec section 15) — deliberately short, to avoid excessive notifications. */
const NOTIFY_ON_STATUS: Record<string, (customerName: string, jobTitle: string | null) => { title: string; body?: string }> = {
  interview_scheduled: (name, job) => ({
    title: `Interview scheduled: ${name}`,
    body: job ? `Next stage for ${job}.` : undefined,
  }),
  selected: (name, job) => ({
    title: `Candidate selected: ${name}`,
    body: job ? `Selected for ${job}.` : undefined,
  }),
};

export async function updateApplicationStatus(
  supabase: SupabaseClient,
  applicationId: string,
  updatedBy: string,
  status: ApplicationItem["status"],
  opts: { rejectionReason?: string } = {}
): Promise<void> {
  const { data: app, error: fetchError } = await supabase
    .from("applications")
    .select("business_id, status, customer_id, opportunity_id, customers:customer_id (full_name), opportunities:opportunity_id (title)")
    .eq("id", applicationId)
    .single();
  if (fetchError) throw fetchError;

  const previousStatus = app.status as string;

  const patch: Record<string, unknown> = { status };
  if (SUBMITTED_STATUSES.has(status)) patch.submitted_at = new Date().toISOString();
  if (status === "rejected" || status === "withdrawn") {
    patch.rejection_reason = opts.rejectionReason || null;
  }

  const { error } = await supabase.from("applications").update(patch).eq("id", applicationId);
  if (error) throw error;

  await logApplicationEvent(supabase, {
    applicationId,
    eventType: "status_changed",
    payload: { from: previousStatus, to: status, rejectionReason: opts.rejectionReason || null },
    createdBy: updatedBy,
  });

  await logActivity(supabase, {
    businessId: app.business_id as string,
    actorId: updatedBy,
    action: "application.status_changed",
    objectType: "application",
    objectId: applicationId,
    metadata: { from: previousStatus, to: status },
  });

  const notify = NOTIFY_ON_STATUS[status];
  if (notify && previousStatus !== status) {
    const customerName =
      (app.customers as unknown as { full_name: string } | null)?.full_name ?? "A candidate";
    const jobTitle = (app.opportunities as unknown as { title: string } | null)?.title ?? null;
    const { title, body } = notify(customerName, jobTitle);
    await createNotification(supabase, {
      businessId: app.business_id as string,
      level: "normal",
      title,
      body,
      relatedType: "application",
      relatedId: applicationId,
    });
  }
}

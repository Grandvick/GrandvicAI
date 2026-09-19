import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplicationInput } from "./validation";
import { logActivity } from "./audit";

export type ApplicationItem = {
  id: string;
  customerId: string;
  customerName: string;
  leadId: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  status: string;
  notes: string | null;
  submittedAt: string | null;
  createdAt: string;
};

const APPLICATION_SELECT =
  "id, customer_id, lead_id, opportunity_id, status, notes, submitted_at, created_at, customers:customer_id (full_name), opportunities:opportunity_id (title)";

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
    notes: row.notes,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  };
}

export async function listApplications(
  supabase: SupabaseClient,
  businessId: string,
  opts: { customerId?: string; leadId?: string } = {}
): Promise<ApplicationItem[]> {
  let query = supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (opts.customerId) query = query.eq("customer_id", opts.customerId);
  if (opts.leadId) query = query.eq("lead_id", opts.leadId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapApplication);
}

export async function createApplication(
  supabase: SupabaseClient,
  businessId: string,
  createdBy: string,
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
      submitted_at: input.status === "submitted" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw error;

  await logActivity(supabase, {
    businessId,
    actorId: createdBy,
    action: "application.created",
    objectType: "application",
    objectId: data.id as string,
  });

  return data.id as string;
}

export async function updateApplicationStatus(
  supabase: SupabaseClient,
  applicationId: string,
  updatedBy: string,
  status: ApplicationItem["status"]
): Promise<void> {
  const { data: app, error: fetchError } = await supabase
    .from("applications")
    .select("business_id")
    .eq("id", applicationId)
    .single();
  if (fetchError) throw fetchError;

  const patch: Record<string, unknown> = { status };
  if (status === "submitted") patch.submitted_at = new Date().toISOString();

  const { error } = await supabase.from("applications").update(patch).eq("id", applicationId);
  if (error) throw error;

  await logActivity(supabase, {
    businessId: app.business_id as string,
    actorId: updatedBy,
    action: "application.status_changed",
    objectType: "application",
    objectId: applicationId,
    metadata: { status },
  });
}

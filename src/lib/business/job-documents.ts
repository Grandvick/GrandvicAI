import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobDocumentRequirementInput } from "./validation";
import { logActivity } from "./audit";
import { logApplicationEvent } from "./application-events";
import { createNotification } from "./notifications";

/**
 * Flexible, job-specific document requirements (spec section 10 — "do not
 * hard-code these documents into the UI"). `document_type` is free text so
 * an owner can require anything a job needs; the UI (JobDocumentsEditor)
 * offers common suggestions but never restricts input to a fixed list.
 */
export type JobDocumentRequirement = {
  id: string;
  opportunityId: string;
  documentType: string;
  isMandatory: boolean;
  notes: string | null;
};

export async function listJobDocumentRequirements(
  supabase: SupabaseClient,
  opportunityId: string
): Promise<JobDocumentRequirement[]> {
  const { data, error } = await supabase
    .from("document_requirements")
    .select("id, opportunity_id, document_type, is_mandatory, notes")
    .eq("opportunity_id", opportunityId)
    .order("document_type", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    opportunityId: r.opportunity_id as string,
    documentType: r.document_type as string,
    isMandatory: r.is_mandatory as boolean,
    notes: r.notes as string | null,
  }));
}

export async function addJobDocumentRequirement(
  supabase: SupabaseClient,
  businessId: string,
  addedBy: string,
  input: JobDocumentRequirementInput
): Promise<string> {
  const { data, error } = await supabase
    .from("document_requirements")
    .insert({
      business_id: businessId,
      opportunity_id: input.opportunityId,
      document_type: input.documentType,
      is_mandatory: input.isMandatory,
      notes: input.notes || null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error(`"${input.documentType}" is already required for this job.`);
    }
    throw error;
  }

  await logActivity(supabase, {
    businessId,
    actorId: addedBy,
    action: "job.document_requirement_added",
    objectType: "opportunity",
    objectId: input.opportunityId,
    metadata: { documentType: input.documentType, isMandatory: input.isMandatory },
  });

  return data.id as string;
}

export async function removeJobDocumentRequirement(
  supabase: SupabaseClient,
  requirementId: string,
  removedBy: string
): Promise<void> {
  const { data: req, error: fetchError } = await supabase
    .from("document_requirements")
    .select("business_id, opportunity_id, document_type")
    .eq("id", requirementId)
    .single();
  if (fetchError) throw fetchError;

  const { error } = await supabase.from("document_requirements").delete().eq("id", requirementId);
  if (error) throw error;

  await logActivity(supabase, {
    businessId: req.business_id as string,
    actorId: removedBy,
    action: "job.document_requirement_removed",
    objectType: "opportunity",
    objectId: req.opportunity_id as string,
    metadata: { documentType: req.document_type },
  });
}

export type ApplicationDocumentStatus = {
  documentType: string;
  isMandatory: boolean;
  documentId: string | null;
  status: "missing" | "requested" | "uploaded" | "received" | "pending_review" | "approved" | "rejected" | "expired";
};

/**
 * The Required / Submitted / Missing / Approved / Rejected matrix for one
 * candidate's application (spec section 10, 11) — joins the job's document
 * requirements against the documents actually submitted against THIS
 * application (documents.application_id), so it's specific to this
 * candidate's attempt at this job, not their documents in general.
 */
export async function getApplicationDocumentChecklist(
  supabase: SupabaseClient,
  applicationId: string
): Promise<ApplicationDocumentStatus[]> {
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("opportunity_id")
    .eq("id", applicationId)
    .single();
  if (appError) throw appError;

  const opportunityId = application.opportunity_id as string | null;
  if (!opportunityId) return [];

  const [requirements, documents] = await Promise.all([
    listJobDocumentRequirements(supabase, opportunityId),
    supabase
      .from("documents")
      .select("id, document_type, status")
      .eq("application_id", applicationId),
  ]);

  if (documents.error) throw documents.error;
  const submittedByType = new Map((documents.data ?? []).map((d) => [d.document_type as string, d]));

  return requirements.map((req) => {
    const doc = submittedByType.get(req.documentType);
    return {
      documentType: req.documentType,
      isMandatory: req.isMandatory,
      documentId: (doc?.id as string) ?? null,
      status: doc ? (doc.status as ApplicationDocumentStatus["status"]) : "missing",
    };
  });
}

/**
 * Fires the "candidate documents completed" notification (spec section 15)
 * exactly once per application — call this after a document's status
 * changes to `approved`, and it only notifies if every MANDATORY document is
 * now approved (not merely submitted).
 */
export async function maybeNotifyDocumentsComplete(
  supabase: SupabaseClient,
  businessId: string,
  applicationId: string
): Promise<void> {
  const checklist = await getApplicationDocumentChecklist(supabase, applicationId);
  const mandatory = checklist.filter((c) => c.isMandatory);
  if (mandatory.length === 0 || !mandatory.every((c) => c.status === "approved")) return;

  const { data: application } = await supabase
    .from("applications")
    .select("status, customers:customer_id (full_name), opportunities:opportunity_id (title)")
    .eq("id", applicationId)
    .single();
  if (!application || application.status === "documents_complete") return;

  const customerName =
    (application.customers as unknown as { full_name: string } | null)?.full_name ?? "A candidate";
  const jobTitle = (application.opportunities as unknown as { title: string } | null)?.title ?? "a job";

  await logApplicationEvent(supabase, {
    applicationId,
    eventType: "documents_completed",
    payload: {},
  });

  await createNotification(supabase, {
    businessId,
    level: "normal",
    title: `Documents complete: ${customerName}`,
    body: `All required documents for ${jobTitle} have been approved.`,
    relatedType: "application",
    relatedId: applicationId,
  });
}

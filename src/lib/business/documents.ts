import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentRequestInput } from "./validation";
import { logActivity } from "./audit";

export const DOCUMENTS_BUCKET = "documents";
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8MB
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type DocumentItem = {
  id: string;
  customerId: string;
  customerName: string;
  documentType: string;
  status: string;
  storagePath: string | null;
  notes: string | null;
  requestedAt: string;
  uploadedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

const DOCUMENT_SELECT =
  "id, customer_id, document_type, status, storage_path, notes, requested_at, uploaded_at, reviewed_at, customers:customer_id (full_name), reviewer:reviewed_by (full_name)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocument(row: any): DocumentItem {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customers?.full_name ?? "Unknown customer",
    documentType: row.document_type,
    status: row.status,
    storagePath: row.storage_path,
    notes: row.notes,
    requestedAt: row.requested_at,
    uploadedAt: row.uploaded_at,
    reviewedByName: row.reviewer?.full_name ?? null,
    reviewedAt: row.reviewed_at,
  };
}

export async function listDocuments(
  supabase: SupabaseClient,
  businessId: string,
  opts: { customerId?: string } = {}
): Promise<DocumentItem[]> {
  let query = supabase
    .from("documents")
    .select(DOCUMENT_SELECT)
    .eq("business_id", businessId)
    .order("requested_at", { ascending: false });

  if (opts.customerId) query = query.eq("customer_id", opts.customerId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

export async function createDocumentRequest(
  supabase: SupabaseClient,
  businessId: string,
  requestedBy: string,
  input: DocumentRequestInput
): Promise<string> {
  const { data, error } = await supabase
    .from("documents")
    .insert({
      business_id: businessId,
      customer_id: input.customerId,
      application_id: input.applicationId || null,
      document_type: input.documentType,
      status: "requested",
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error) throw error;

  await logActivity(supabase, {
    businessId,
    actorId: requestedBy,
    action: "document.requested",
    objectType: "document",
    objectId: data.id as string,
    metadata: { documentType: input.documentType },
  });

  return data.id as string;
}

/** Validates a File before it's ever uploaded — never trust the client's own filtering. */
export function validateDocumentFile(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "The file appears to be empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "File is larger than the 8MB limit.";
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    return "Only PDF, JPG, PNG, or WEBP files are accepted.";
  }
  return null;
}

export async function attachDocumentFile(
  supabase: SupabaseClient,
  businessId: string,
  documentId: string,
  uploadedBy: string,
  file: File
): Promise<void> {
  const validationError = validateDocumentFile(file);
  if (validationError) throw new Error(validationError);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${businessId}/${documentId}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error } = await supabase
    .from("documents")
    .update({ storage_path: path, status: "uploaded", uploaded_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) throw error;

  await logActivity(supabase, {
    businessId,
    actorId: uploadedBy,
    action: "document.uploaded",
    objectType: "document",
    objectId: documentId,
  });
}

export async function updateDocumentStatus(
  supabase: SupabaseClient,
  documentId: string,
  reviewedBy: string,
  status: DocumentItem["status"],
  notes?: string
): Promise<void> {
  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("business_id")
    .eq("id", documentId)
    .single();
  if (fetchError) throw fetchError;

  const isReviewDecision = status === "approved" || status === "rejected";

  const { error } = await supabase
    .from("documents")
    .update({
      status,
      notes: notes ?? undefined,
      reviewed_by: isReviewDecision ? reviewedBy : undefined,
      reviewed_at: isReviewDecision ? new Date().toISOString() : undefined,
    })
    .eq("id", documentId);
  if (error) throw error;

  await logActivity(supabase, {
    businessId: doc.business_id as string,
    actorId: reviewedBy,
    action: "document.status_changed",
    objectType: "document",
    objectId: documentId,
    metadata: { status },
  });
}

/**
 * A short-lived signed URL to view/download a private document. Generated
 * server-side on demand — never store a permanent public link.
 */
export async function getDocumentDownloadUrl(
  supabase: SupabaseClient,
  storagePath: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

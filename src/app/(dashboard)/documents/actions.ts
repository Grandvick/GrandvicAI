"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { documentRequestSchema } from "@/lib/business/validation";
import {
  createDocumentRequest,
  attachDocumentFile,
  updateDocumentStatus,
  getDocumentDownloadUrl,
  type DocumentItem,
} from "@/lib/business/documents";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;
export type UploadState = { error?: string } | undefined;

function readDocumentRequestForm(formData: FormData) {
  return {
    customerId: String(formData.get("customerId") || ""),
    applicationId: String(formData.get("applicationId") || ""),
    documentType: String(formData.get("documentType") || ""),
    notes: String(formData.get("notes") || ""),
  };
}

export async function createDocumentRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = documentRequestSchema.safeParse(readDocumentRequestForm(formData));
  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const { supabase, user } = await requireCurrentUser();
  let businessId: string;
  try {
    businessId = await resolveBusinessId(supabase, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not determine business." };
  }

  try {
    await createDocumentRequest(supabase, businessId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create document request." };
  }

  revalidatePath("/documents");
  redirect("/documents");
}

/** Bound with a documentId and used directly as a form action from DocumentRow. */
export async function uploadDocumentFileAction(
  documentId: string,
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const { supabase, user } = await requireCurrentUser();

  // RLS already scopes this select to the caller's business (or every
  // business for the owner), so a successful read here is itself proof the
  // caller is allowed to touch this document.
  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("business_id")
    .eq("id", documentId)
    .single();
  if (fetchError || !doc) {
    return { error: "Document not found." };
  }

  try {
    await attachDocumentFile(supabase, doc.business_id as string, documentId, user.userId, file);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  revalidatePath("/documents");
  return {};
}

/** Called directly from the documents list's inline status dropdown (no form). */
export async function updateDocumentStatusAction(
  documentId: string,
  status: DocumentItem["status"]
): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    await updateDocumentStatus(supabase, documentId, user.userId, status);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update status." };
  }

  revalidatePath("/documents");
  return {};
}

/** Generates a fresh 60-second signed URL on demand — never stored, never reused. */
export async function getDocumentUrlAction(storagePath: string): Promise<{ url?: string; error?: string }> {
  const { supabase } = await requireCurrentUser();

  try {
    const url = await getDocumentDownloadUrl(supabase, storagePath);
    return { url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not generate a download link." };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatten(error: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues ?? []) {
    const key = issue.path[0];
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

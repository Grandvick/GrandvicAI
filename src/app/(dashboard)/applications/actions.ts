"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { applicationSchema } from "@/lib/business/validation";
import { createApplication, updateApplicationStatus, type ApplicationItem } from "@/lib/business/applications";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function readApplicationForm(formData: FormData) {
  return {
    customerId: String(formData.get("customerId") || ""),
    leadId: String(formData.get("leadId") || ""),
    opportunityId: String(formData.get("opportunityId") || ""),
    status: String(formData.get("status") || "new"),
    notes: String(formData.get("notes") || ""),
  };
}

export async function createApplicationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = applicationSchema.safeParse(readApplicationForm(formData));
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
    await createApplication(supabase, businessId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create application." };
  }

  revalidatePath("/applications");
  redirect("/applications");
}

/** Called directly from the applications list's inline status dropdown (no form). */
export async function updateApplicationStatusAction(
  applicationId: string,
  status: ApplicationItem["status"],
  rejectionReason?: string
): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    await updateApplicationStatus(supabase, applicationId, user.userId, status, { rejectionReason });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update application." };
  }

  revalidatePath("/applications");
  revalidatePath(`/applications/${applicationId}`);
  return {};
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

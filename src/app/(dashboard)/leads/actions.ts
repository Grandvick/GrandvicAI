"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { leadSchema, leadNoteSchema } from "@/lib/business/validation";
import { createLead, updateLeadPipeline, addLeadNote } from "@/lib/business/leads";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function readLeadForm(formData: FormData) {
  return {
    customerId: String(formData.get("customerId") || ""),
    moduleId: String(formData.get("moduleId") || ""),
    service: String(formData.get("service") || ""),
    targetCountry: String(formData.get("targetCountry") || ""),
    source: String(formData.get("source") || ""),
    stage: String(formData.get("stage") || "new"),
    score: String(formData.get("score") || "0"),
    temperature: String(formData.get("temperature") || "nurture"),
    assignedTo: String(formData.get("assignedTo") || ""),
  };
}

export async function createLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = leadSchema.safeParse(readLeadForm(formData));
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

  let leadId: string;
  try {
    leadId = await createLead(supabase, businessId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create lead." };
  }

  revalidatePath("/leads");
  revalidatePath(`/customers/${parsed.data.customerId}`);
  redirect(`/leads/${leadId}`);
}

export async function updateLeadPipelineAction(
  leadId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const stage = String(formData.get("stage") || "");
  const scoreRaw = formData.get("score");
  const temperature = String(formData.get("temperature") || "");
  const assignedToRaw = String(formData.get("assignedTo") || "");

  const { supabase, user } = await requireCurrentUser();

  try {
    await updateLeadPipeline(supabase, leadId, user.userId, {
      stage: stage || undefined,
      score: scoreRaw !== null && scoreRaw !== "" ? Number(scoreRaw) : undefined,
      temperature: (temperature as "hot" | "warm" | "nurture") || undefined,
      // "" means the "Unassigned" option was explicitly chosen — pass null so
      // updateLeadPipeline treats it as a real change, not "leave as-is".
      assignedTo: assignedToRaw === "" ? null : assignedToRaw,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update lead." };
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { error: undefined };
}

export async function addLeadNoteAction(
  leadId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = leadNoteSchema.safeParse({ leadId, note: String(formData.get("note") || "") });
  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const { supabase, user } = await requireCurrentUser();
  try {
    await addLeadNote(supabase, leadId, user.userId, parsed.data.note);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add note." };
  }

  revalidatePath(`/leads/${leadId}`);
  return { error: undefined };
}

/** Called directly from the Kanban board's drag-and-drop handler (no form). */
export async function moveLeadStageAction(
  leadId: string,
  stage: string
): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    await updateLeadPipeline(supabase, leadId, user.userId, { stage });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to move lead." };
  }

  revalidatePath("/leads");
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

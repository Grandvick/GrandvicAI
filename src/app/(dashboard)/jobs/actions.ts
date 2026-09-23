"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { jobSchema, jobDocumentRequirementSchema } from "@/lib/business/validation";
import {
  createJob,
  updateJob,
  setJobStatus,
  duplicateJob,
  type JobStatus,
} from "@/lib/business/jobs";
import { addJobDocumentRequirement, removeJobDocumentRequirement } from "@/lib/business/job-documents";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function readJobForm(formData: FormData) {
  return {
    title: String(formData.get("title") || ""),
    country: String(formData.get("country") || ""),
    city: String(formData.get("city") || ""),
    employer: String(formData.get("employer") || ""),
    recruiterName: String(formData.get("recruiterName") || ""),
    category: String(formData.get("category") || ""),
    employmentType: String(formData.get("employmentType") || ""),
    contractDuration: String(formData.get("contractDuration") || ""),
    numVacancies: formData.get("numVacancies") ? Number(formData.get("numVacancies")) : undefined,
    salaryAmount: formData.get("salaryAmount") ? Number(formData.get("salaryAmount")) : undefined,
    salaryCurrency: String(formData.get("salaryCurrency") || ""),
    salaryPeriod: String(formData.get("salaryPeriod") || ""),
    accommodationProvided: checkbox(formData, "accommodationProvided"),
    accommodation: String(formData.get("accommodation") || ""),
    mealsProvided: checkbox(formData, "mealsProvided"),
    meals: String(formData.get("meals") || ""),
    transportProvided: checkbox(formData, "transportProvided"),
    airfareProvided: checkbox(formData, "airfareProvided"),
    visaWorkPermitSupport: checkbox(formData, "visaWorkPermitSupport"),
    workingHours: String(formData.get("workingHours") || ""),
    educationRequirement: String(formData.get("educationRequirement") || ""),
    experienceRequirement: String(formData.get("experienceRequirement") || ""),
    licenseRequirement: String(formData.get("licenseRequirement") || ""),
    languageRequirement: String(formData.get("languageRequirement") || ""),
    minAge: formData.get("minAge") ? Number(formData.get("minAge")) : undefined,
    maxAge: formData.get("maxAge") ? Number(formData.get("maxAge")) : undefined,
    genderRequirement: String(formData.get("genderRequirement") || ""),
    passportRequired: checkbox(formData, "passportRequired"),
    medicalRequirement: String(formData.get("medicalRequirement") || ""),
    jobDescription: String(formData.get("jobDescription") || ""),
    responsibilities: String(formData.get("responsibilities") || ""),
    candidateRequirements: String(formData.get("candidateRequirements") || ""),
    benefits: String(formData.get("benefits") || ""),
    applicationProcess: String(formData.get("applicationProcess") || ""),
    fees: String(formData.get("fees") || ""),
    recruiterReference: String(formData.get("recruiterReference") || ""),
    openingDate: String(formData.get("openingDate") || ""),
    applicationDeadline: String(formData.get("applicationDeadline") || ""),
    expiryAt: String(formData.get("expiryAt") || ""),
    source: String(formData.get("source") || ""),
    notes: String(formData.get("notes") || ""),
  };
}

export async function createJobAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = jobSchema.safeParse(readJobForm(formData));
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const { supabase, user } = await requireCurrentUser();
  let businessId: string;
  try {
    businessId = await resolveBusinessId(supabase, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not determine business." };
  }

  let jobId: string;
  try {
    jobId = await createJob(supabase, businessId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create job." };
  }

  revalidatePath("/jobs");
  redirect(`/jobs/${jobId}`);
}

export async function updateJobAction(jobId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = jobSchema.safeParse(readJobForm(formData));
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const { supabase, user } = await requireCurrentUser();

  try {
    await updateJob(supabase, jobId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update job." };
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}`);
}

export async function setJobStatusAction(jobId: string, status: JobStatus): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    await setJobStatus(supabase, jobId, user.userId, status);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to change job status." };
  }

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  return {};
}

export async function duplicateJobAction(jobId: string): Promise<{ error?: string; newJobId?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    const newJobId = await duplicateJob(supabase, jobId, user.userId);
    revalidatePath("/jobs");
    return { newJobId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to duplicate job." };
  }
}

export async function addJobDocumentRequirementAction(
  opportunityId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = jobDocumentRequirementSchema.safeParse({
    opportunityId,
    documentType: String(formData.get("documentType") || ""),
    isMandatory: checkbox(formData, "isMandatory"),
    notes: String(formData.get("notes") || ""),
  });
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const { supabase, user } = await requireCurrentUser();
  const { data: job } = await supabase.from("opportunities").select("business_id").eq("id", opportunityId).single();
  if (!job) return { error: "Job not found." };

  try {
    await addJobDocumentRequirement(supabase, job.business_id as string, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add document requirement." };
  }

  revalidatePath(`/jobs/${opportunityId}`);
  return {};
}

export async function removeJobDocumentRequirementAction(
  requirementId: string,
  opportunityId: string
): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    await removeJobDocumentRequirement(supabase, requirementId, user.userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to remove document requirement." };
  }

  revalidatePath(`/jobs/${opportunityId}`);
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

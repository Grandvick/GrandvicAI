import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobInput } from "./validation";
import { logActivity } from "./audit";
import { createNotification } from "./notifications";

export type JobStatus = "draft" | "pending_review" | "open" | "paused" | "closed" | "expired";

export type JobListItem = {
  id: string;
  businessId: string;
  title: string;
  country: string | null;
  city: string | null;
  employer: string | null;
  recruiterName: string | null;
  category: string | null;
  employmentType: string | null;
  numVacancies: number | null;
  salaryAmount: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  status: JobStatus;
  /** `status` as it should be treated right now — see computeEffectiveJobStatus. */
  effectiveStatus: JobStatus;
  applicationDeadline: string | null;
  expiryAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  applicantCount: number;
};

export type JobDetail = JobListItem & {
  moduleId: string | null;
  contractDuration: string | null;
  accommodationProvided: boolean;
  accommodation: string | null;
  mealsProvided: boolean;
  meals: string | null;
  transportProvided: boolean;
  airfareProvided: boolean;
  visaWorkPermitSupport: boolean;
  workingHours: string | null;
  requirements: string[];
  educationRequirement: string | null;
  experienceRequirement: string | null;
  licenseRequirement: string | null;
  languageRequirement: string | null;
  minAge: number | null;
  maxAge: number | null;
  genderRequirement: string | null;
  passportRequired: boolean;
  medicalRequirement: string | null;
  jobDescription: string | null;
  responsibilities: string | null;
  candidateRequirements: string | null;
  benefits: string | null;
  applicationProcess: string | null;
  fees: string | null;
  recruiterReference: string | null;
  openingDate: string | null;
  notes: string | null;
};

export type JobsSummary = {
  totalJobs: number;
  openJobs: number;
  pausedJobs: number;
  closedJobs: number;
  expiredJobs: number;
  expiringSoonJobs: number;
  totalApplications: number;
  newApplicants: number;
  candidatesAwaitingDocuments: number;
  candidatesAwaitingInterview: number;
};

const EXPIRING_SOON_WINDOW_DAYS = 7;

// -----------------------------------------------------------------------------
// Pure functions — no I/O, fully unit-testable. There is no scheduler/cron in
// this app yet (that's Phase 10's "automatic job expiry sweeps" — see
// DEVELOPMENT_PROGRESS.md), so job expiry (spec section 12) is enforced
// reactively: every read path below computes the effective status live, and
// opportunistically writes it back to the stored `status` column the first
// time it's observed to be stale ("a controlled mechanism", not silent).
// -----------------------------------------------------------------------------

/** True once `expiry_at` has passed, regardless of the stored status. */
export function isJobExpired(job: { expiryAt: string | null }, now: Date = new Date()): boolean {
  if (!job.expiryAt) return false;
  return new Date(job.expiryAt).getTime() < now.getTime();
}

/**
 * The status a job should be TREATED as right now, independent of what's
 * stored. Only an `open` job can silently become `expired` this way — a
 * job that was manually paused/closed/drafted never gets reinterpreted,
 * since expiry only protects against a job that's currently being actively
 * marketed as available (spec section 2).
 */
export function computeEffectiveJobStatus(
  job: { status: string; expiryAt: string | null },
  now: Date = new Date()
): JobStatus {
  if (job.status === "open" && isJobExpired(job, now)) return "expired";
  return job.status as JobStatus;
}

/** The one predicate future marketing/recommendation systems must use (spec section 2, 12). */
export function isJobOpenForPromotion(
  job: { status: string; expiryAt: string | null },
  now: Date = new Date()
): boolean {
  return computeEffectiveJobStatus(job, now) === "open";
}

export function isJobExpiringSoon(
  job: { status: string; expiryAt: string | null },
  now: Date = new Date(),
  windowDays: number = EXPIRING_SOON_WINDOW_DAYS
): boolean {
  if (computeEffectiveJobStatus(job, now) !== "open" || !job.expiryAt) return false;
  const msUntilExpiry = new Date(job.expiryAt).getTime() - now.getTime();
  return msUntilExpiry >= 0 && msUntilExpiry <= windowDays * 24 * 60 * 60 * 1000;
}

const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ["pending_review", "open"],
  pending_review: ["draft", "open"],
  open: ["paused", "closed", "expired"],
  paused: ["open", "closed"],
  closed: [],
  expired: ["open", "closed"],
};

/** Enforces the workflow in spec section 4 (DRAFT -> OPEN -> PAUSED -> OPEN -> CLOSED, OPEN -> EXPIRED). */
export function isValidJobStatusTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// -----------------------------------------------------------------------------
// Data access
// -----------------------------------------------------------------------------

const JOB_LIST_SELECT =
  "id, business_id, title, country, city, employer, recruiter_name, category, employment_type, " +
  "num_vacancies, salary_amount, salary_currency, salary_period, status, application_deadline, " +
  "expiry_at, published_at, closed_at, source, created_at, updated_at, applications(count)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapJobListItem(row: any): JobListItem {
  const base = {
    id: row.id as string,
    businessId: row.business_id as string,
    title: row.title as string,
    country: row.country as string | null,
    city: row.city as string | null,
    employer: row.employer as string | null,
    recruiterName: row.recruiter_name as string | null,
    category: row.category as string | null,
    employmentType: row.employment_type as string | null,
    numVacancies: row.num_vacancies as number | null,
    salaryAmount: row.salary_amount as number | null,
    salaryCurrency: row.salary_currency as string | null,
    salaryPeriod: row.salary_period as string | null,
    status: row.status as JobStatus,
    applicationDeadline: row.application_deadline as string | null,
    expiryAt: row.expiry_at as string | null,
    publishedAt: row.published_at as string | null,
    closedAt: row.closed_at as string | null,
    source: row.source as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    applicantCount:
      Array.isArray(row.applications) && row.applications[0]
        ? (row.applications[0] as { count: number }).count
        : 0,
  };
  return { ...base, effectiveStatus: computeEffectiveJobStatus(base) };
}

/**
 * Opportunistically writes back `status = 'expired'` for jobs whose stored
 * status is still `open` but whose expiry_at has passed — the "controlled
 * mechanism" spec section 12 asks for, given there's no scheduler yet. Never
 * throws: a failed touch-up just means the next read tries again, and every
 * READ path already computes the correct effective status regardless via
 * computeEffectiveJobStatus, so this is a best-effort optimization, not a
 * correctness requirement.
 */
async function touchUpExpiredJobs(supabase: SupabaseClient, jobs: JobListItem[]): Promise<void> {
  const staleIds = jobs.filter((j) => j.status === "open" && j.effectiveStatus === "expired").map((j) => j.id);
  if (staleIds.length === 0) return;

  try {
    const { error } = await supabase.from("opportunities").update({ status: "expired" }).in("id", staleIds);
    if (error) throw error;

    for (const job of jobs.filter((j) => staleIds.includes(j.id))) {
      await logActivity(supabase, {
        businessId: job.businessId,
        actorType: "system",
        action: "job.expired",
        objectType: "opportunity",
        objectId: job.id,
        metadata: { reason: "expiry_at passed", expiryAt: job.expiryAt },
      });
      await createNotification(supabase, {
        businessId: job.businessId,
        level: "normal",
        title: `Job expired: ${job.title}`,
        body: "This job passed its expiry date and is no longer shown as open.",
        relatedType: "opportunity",
        relatedId: job.id,
      });
    }
  } catch (err) {
    console.error("job expiry touch-up failed", err);
  }
}

export async function listJobs(
  supabase: SupabaseClient,
  businessId: string,
  opts: {
    status?: string;
    country?: string;
    category?: string;
    recruiterName?: string;
    search?: string;
    sort?: "deadline" | "newest";
  } = {}
): Promise<JobListItem[]> {
  let query = supabase.from("opportunities").select(JOB_LIST_SELECT).eq("business_id", businessId);

  if (opts.status) query = query.eq("status", opts.status);
  if (opts.country) query = query.eq("country", opts.country);
  if (opts.category) query = query.eq("category", opts.category);
  if (opts.recruiterName) query = query.eq("recruiter_name", opts.recruiterName);

  if (opts.sort === "deadline") {
    query = query.order("application_deadline", { ascending: true, nullsFirst: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;

  let jobs = (data ?? []).map(mapJobListItem);

  if (opts.search) {
    const term = opts.search.trim().toLowerCase();
    if (term) {
      jobs = jobs.filter(
        (j) =>
          j.title.toLowerCase().includes(term) ||
          (j.country ?? "").toLowerCase().includes(term) ||
          (j.city ?? "").toLowerCase().includes(term) ||
          (j.employer ?? "").toLowerCase().includes(term) ||
          (j.recruiterName ?? "").toLowerCase().includes(term)
      );
    }
  }

  await touchUpExpiredJobs(supabase, jobs);

  return jobs;
}

/** Read-only options list for linking an application to a job — mirrors the Phase 1 opportunities.ts helper. */
export async function listJobsForSelect(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ id: string; title: string; status: JobStatus; country: string | null }[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, title, status, country, expiry_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    status: computeEffectiveJobStatus({ status: r.status as string, expiryAt: r.expiry_at as string | null }),
    country: r.country as string | null,
  }));
}

const JOB_DETAIL_SELECT =
  JOB_LIST_SELECT +
  ", module_id, contract_duration, accommodation_provided, accommodation, meals_provided, meals, " +
  "transport_provided, airfare_provided, visa_work_permit_support, working_hours, requirements, " +
  "education_requirement, experience_requirement, license_requirement, language_requirement, " +
  "min_age, max_age, gender_requirement, passport_required, medical_requirement, job_description, " +
  "responsibilities, candidate_requirements, benefits, application_process, fees, recruiter_reference, " +
  "opening_date, notes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapJobDetail(row: any): JobDetail {
  return {
    ...mapJobListItem(row),
    moduleId: row.module_id,
    contractDuration: row.contract_duration,
    accommodationProvided: row.accommodation_provided,
    accommodation: row.accommodation,
    mealsProvided: row.meals_provided,
    meals: row.meals,
    transportProvided: row.transport_provided,
    airfareProvided: row.airfare_provided,
    visaWorkPermitSupport: row.visa_work_permit_support,
    workingHours: row.working_hours,
    requirements: row.requirements ?? [],
    educationRequirement: row.education_requirement,
    experienceRequirement: row.experience_requirement,
    licenseRequirement: row.license_requirement,
    languageRequirement: row.language_requirement,
    minAge: row.min_age,
    maxAge: row.max_age,
    genderRequirement: row.gender_requirement,
    passportRequired: row.passport_required,
    medicalRequirement: row.medical_requirement,
    jobDescription: row.job_description,
    responsibilities: row.responsibilities,
    candidateRequirements: row.candidate_requirements,
    benefits: row.benefits,
    applicationProcess: row.application_process,
    fees: row.fees,
    recruiterReference: row.recruiter_reference,
    openingDate: row.opening_date,
    notes: row.notes,
  };
}

export async function getJob(supabase: SupabaseClient, id: string): Promise<JobDetail | null> {
  const { data, error } = await supabase.from("opportunities").select(JOB_DETAIL_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const job = mapJobDetail(data);
  await touchUpExpiredJobs(supabase, [job]);
  if (job.status === "open" && job.effectiveStatus === "expired") {
    return { ...job, status: "expired" };
  }
  return job;
}

function jobInputToRow(input: JobInput): Record<string, unknown> {
  return {
    module_id: input.moduleId || null,
    title: input.title,
    country: input.country || null,
    city: input.city || null,
    employer: input.employer || null,
    recruiter_name: input.recruiterName || null,
    category: input.category || null,
    employment_type: input.employmentType || null,
    contract_duration: input.contractDuration || null,
    num_vacancies: input.numVacancies ?? null,
    salary_amount: input.salaryAmount ?? null,
    salary_currency: input.salaryCurrency || null,
    salary_period: input.salaryPeriod || null,
    accommodation_provided: input.accommodationProvided,
    accommodation: input.accommodation || null,
    meals_provided: input.mealsProvided,
    meals: input.meals || null,
    transport_provided: input.transportProvided,
    airfare_provided: input.airfareProvided,
    visa_work_permit_support: input.visaWorkPermitSupport,
    working_hours: input.workingHours || null,
    education_requirement: input.educationRequirement || null,
    experience_requirement: input.experienceRequirement || null,
    license_requirement: input.licenseRequirement || null,
    language_requirement: input.languageRequirement || null,
    min_age: input.minAge ?? null,
    max_age: input.maxAge ?? null,
    gender_requirement: input.genderRequirement || null,
    passport_required: input.passportRequired,
    medical_requirement: input.medicalRequirement || null,
    job_description: input.jobDescription || null,
    responsibilities: input.responsibilities || null,
    candidate_requirements: input.candidateRequirements || null,
    benefits: input.benefits || null,
    application_process: input.applicationProcess || null,
    fees: input.fees || null,
    recruiter_reference: input.recruiterReference || null,
    opening_date: input.openingDate || null,
    application_deadline: input.applicationDeadline || null,
    expiry_at: input.expiryAt ? new Date(input.expiryAt).toISOString() : null,
    source: input.source || null,
  };
}

export async function createJob(
  supabase: SupabaseClient,
  businessId: string,
  createdBy: string,
  input: JobInput
): Promise<string> {
  const { data, error } = await supabase
    .from("opportunities")
    .insert({ ...jobInputToRow(input), business_id: businessId, status: "draft", created_by: createdBy })
    .select("id")
    .single();
  if (error) throw error;

  await logActivity(supabase, {
    businessId,
    actorId: createdBy,
    action: "job.created",
    objectType: "opportunity",
    objectId: data.id as string,
    metadata: { title: input.title },
  });

  return data.id as string;
}

export async function updateJob(
  supabase: SupabaseClient,
  id: string,
  updatedBy: string,
  input: JobInput
): Promise<void> {
  const { data, error } = await supabase
    .from("opportunities")
    .update(jobInputToRow(input))
    .eq("id", id)
    .select("business_id")
    .single();
  if (error) throw error;

  await logActivity(supabase, {
    businessId: data.business_id as string,
    actorId: updatedBy,
    action: "job.updated",
    objectType: "opportunity",
    objectId: id,
  });
}

export async function setJobStatus(
  supabase: SupabaseClient,
  id: string,
  updatedBy: string,
  nextStatus: JobStatus
): Promise<void> {
  const { data: job, error: fetchError } = await supabase
    .from("opportunities")
    .select("business_id, status, published_at")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;

  const currentStatus = job.status as JobStatus;
  if (!isValidJobStatusTransition(currentStatus, nextStatus)) {
    throw new Error(`Cannot move a job from "${currentStatus}" to "${nextStatus}".`);
  }

  const patch: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === "open" && !job.published_at) patch.published_at = new Date().toISOString();
  if (nextStatus === "closed") patch.closed_at = new Date().toISOString();

  const { error } = await supabase.from("opportunities").update(patch).eq("id", id);
  if (error) throw error;

  await logActivity(supabase, {
    businessId: job.business_id as string,
    actorId: updatedBy,
    action: `job.${nextStatus}`,
    objectType: "opportunity",
    objectId: id,
    metadata: { from: currentStatus, to: nextStatus },
  });
}

/**
 * Creates a new DRAFT job from an existing one, copying its descriptive
 * fields and document requirements but deliberately NOT copying
 * applications, candidates, audit history, or publishing timestamps (spec
 * section 13).
 */
export async function duplicateJob(
  supabase: SupabaseClient,
  id: string,
  createdBy: string
): Promise<string> {
  const source = await getJob(supabase, id);
  if (!source) throw new Error("Job not found.");

  const { data: inserted, error } = await supabase
    .from("opportunities")
    .insert({
      business_id: source.businessId,
      module_id: source.moduleId,
      title: `${source.title} (Copy)`,
      country: source.country,
      city: source.city,
      employer: source.employer,
      recruiter_name: source.recruiterName,
      category: source.category,
      employment_type: source.employmentType,
      contract_duration: source.contractDuration,
      num_vacancies: source.numVacancies,
      salary_amount: source.salaryAmount,
      salary_currency: source.salaryCurrency,
      salary_period: source.salaryPeriod,
      accommodation_provided: source.accommodationProvided,
      accommodation: source.accommodation,
      meals_provided: source.mealsProvided,
      meals: source.meals,
      transport_provided: source.transportProvided,
      airfare_provided: source.airfareProvided,
      visa_work_permit_support: source.visaWorkPermitSupport,
      working_hours: source.workingHours,
      requirements: source.requirements,
      education_requirement: source.educationRequirement,
      experience_requirement: source.experienceRequirement,
      license_requirement: source.licenseRequirement,
      language_requirement: source.languageRequirement,
      min_age: source.minAge,
      max_age: source.maxAge,
      gender_requirement: source.genderRequirement,
      passport_required: source.passportRequired,
      medical_requirement: source.medicalRequirement,
      job_description: source.jobDescription,
      responsibilities: source.responsibilities,
      candidate_requirements: source.candidateRequirements,
      benefits: source.benefits,
      application_process: source.applicationProcess,
      fees: source.fees,
      recruiter_reference: source.recruiterReference,
      status: "draft",
      created_by: createdBy,
      // Deliberately omitted: application_deadline, expiry_at, published_at,
      // closed_at — a duplicate is a fresh draft, not a republish.
    })
    .select("id")
    .single();
  if (error) throw error;
  const newJobId = inserted.id as string;

  const { data: requirements, error: reqError } = await supabase
    .from("document_requirements")
    .select("document_type, is_mandatory, notes")
    .eq("opportunity_id", id);
  if (reqError) throw reqError;

  if (requirements && requirements.length > 0) {
    const { error: insertReqError } = await supabase.from("document_requirements").insert(
      requirements.map((r) => ({
        business_id: source.businessId,
        module_id: source.moduleId,
        opportunity_id: newJobId,
        document_type: r.document_type,
        is_mandatory: r.is_mandatory,
        notes: r.notes,
      }))
    );
    if (insertReqError) throw insertReqError;
  }

  await logActivity(supabase, {
    businessId: source.businessId,
    actorId: createdBy,
    action: "job.duplicated",
    objectType: "opportunity",
    objectId: newJobId,
    metadata: { sourceJobId: id },
  });

  return newJobId;
}

export async function getJobsSummary(supabase: SupabaseClient, businessId: string): Promise<JobsSummary> {
  const jobs = await listJobs(supabase, businessId);
  const now = new Date();

  const [applicationsCount, newApplicants, awaitingDocuments, awaitingInterview] = await Promise.all([
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .not("opportunity_id", "is", null),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "new")
      .not("opportunity_id", "is", null),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "documents_pending")
      .not("opportunity_id", "is", null),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "interview_scheduled")
      .not("opportunity_id", "is", null),
  ]);

  return {
    totalJobs: jobs.length,
    openJobs: jobs.filter((j) => j.effectiveStatus === "open").length,
    pausedJobs: jobs.filter((j) => j.effectiveStatus === "paused").length,
    closedJobs: jobs.filter((j) => j.effectiveStatus === "closed").length,
    expiredJobs: jobs.filter((j) => j.effectiveStatus === "expired").length,
    expiringSoonJobs: jobs.filter((j) => isJobExpiringSoon(j, now)).length,
    totalApplications: applicationsCount.count ?? 0,
    newApplicants: newApplicants.count ?? 0,
    candidatesAwaitingDocuments: awaitingDocuments.count ?? 0,
    candidatesAwaitingInterview: awaitingInterview.count ?? 0,
  };
}

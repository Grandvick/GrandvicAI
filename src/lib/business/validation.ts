import { z } from "zod";

/**
 * Zod schemas for every Phase 1 CRM mutation. Centralized here so:
 *   1. Server actions validate input server-side (spec section 33 — never
 *      trust client input, a Server Action is a public POST endpoint).
 *   2. The same schema can be unit-tested without touching the database.
 */

export const customerSchema = z.object({
  businessId: z.string().uuid().optional(),
  fullName: z.string().trim().min(2, "Enter the customer's full name."),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  country: z.string().trim().max(100).optional().or(z.literal("")),
  profession: z.string().trim().max(150).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const leadSchema = z.object({
  businessId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional().or(z.literal("")),
  customerId: z.string().uuid("Pick a customer for this lead."),
  service: z.string().trim().max(200).optional().or(z.literal("")),
  targetCountry: z.string().trim().max(100).optional().or(z.literal("")),
  source: z.string().trim().max(100).optional().or(z.literal("")),
  stage: z.string().trim().min(1).default("new"),
  score: z.coerce.number().int().min(0).max(100).default(0),
  temperature: z.enum(["hot", "warm", "nurture"]).default("nurture"),
  assignedTo: z.string().uuid().optional().or(z.literal("")),
});
export type LeadInput = z.infer<typeof leadSchema>;

export const leadNoteSchema = z.object({
  leadId: z.string().uuid(),
  note: z.string().trim().min(1, "Write a note first.").max(5000),
});

export const taskSchema = z.object({
  businessId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Give the task a title."),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  dueDate: z.string().trim().optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).default("pending"),
  relatedCustomerId: z.string().uuid().optional().or(z.literal("")),
  relatedLeadId: z.string().uuid().optional().or(z.literal("")),
  relatedOpportunityId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});
export type TaskInput = z.infer<typeof taskSchema>;

/**
 * Recruitment pipeline stages (Phase 2 spec section 9). Kept as a single
 * status field — see supabase/migrations/0003_jobs_abroad.sql — rather than
 * separate screening/submission/interview/placement columns, to avoid the
 * duplication spec section 20 warns against.
 */
export const applicationStatusValues = [
  "new",
  "screening",
  "documents_pending",
  "documents_complete",
  "shortlisted",
  "submitted_to_recruiter",
  "interview_scheduled",
  "interview_completed",
  "selected",
  "offer_received",
  "visa_processing",
  "deployment_pending",
  "placed",
  "rejected",
  "withdrawn",
] as const;

export const applicationSchema = z.object({
  businessId: z.string().uuid().optional(),
  customerId: z.string().uuid("Pick a customer for this application."),
  leadId: z.string().uuid().optional().or(z.literal("")),
  opportunityId: z.string().uuid().optional().or(z.literal("")),
  status: z.enum(applicationStatusValues).default("new"),
  rejectionReason: z.string().trim().max(2000).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;

export const applicationStatusChangeSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(applicationStatusValues),
  rejectionReason: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const documentRequestSchema = z.object({
  businessId: z.string().uuid().optional(),
  customerId: z.string().uuid("Pick a customer for this document."),
  applicationId: z.string().uuid().optional().or(z.literal("")),
  documentType: z.string().trim().min(2, "Say what document this is."),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type DocumentRequestInput = z.infer<typeof documentRequestSchema>;

export const documentStatusSchema = z.object({
  documentId: z.string().uuid(),
  status: z.enum(["requested", "uploaded", "received", "pending_review", "approved", "rejected", "expired"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * Jobs Abroad opportunity (Phase 2 spec section 3/6). Every field is
 * optional except title — a recruiter should be able to save a draft job
 * with only a title and fill in the rest incrementally, matching how the
 * DRAFT status is used in the workflow (spec section 4).
 */
export const jobStatusValues = ["draft", "pending_review", "open", "paused", "closed", "expired"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalDateString = z.string().trim().optional().or(z.literal(""));

export const jobSchema = z.object({
  businessId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(2, "Give the job a title."),
  country: optionalText(100),
  city: optionalText(150),
  employer: optionalText(200),
  recruiterName: optionalText(200),
  category: optionalText(150),
  employmentType: z.enum(["full_time", "part_time", "contract", "temporary", "seasonal", "other"]).optional().or(z.literal("")),
  contractDuration: optionalText(150),
  numVacancies: z.coerce.number().int().min(0).optional(),
  salaryAmount: z.coerce.number().min(0).optional(),
  salaryCurrency: optionalText(10),
  salaryPeriod: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]).optional().or(z.literal("")),
  accommodationProvided: z.boolean().default(false),
  accommodation: optionalText(500),
  mealsProvided: z.boolean().default(false),
  meals: optionalText(500),
  transportProvided: z.boolean().default(false),
  airfareProvided: z.boolean().default(false),
  visaWorkPermitSupport: z.boolean().default(false),
  workingHours: optionalText(150),
  educationRequirement: optionalText(500),
  experienceRequirement: optionalText(500),
  licenseRequirement: optionalText(500),
  languageRequirement: optionalText(500),
  minAge: z.coerce.number().int().min(0).max(120).optional(),
  maxAge: z.coerce.number().int().min(0).max(120).optional(),
  genderRequirement: z.enum(["any", "male", "female"]).optional().or(z.literal("")),
  passportRequired: z.boolean().default(true),
  medicalRequirement: optionalText(500),
  jobDescription: optionalText(10000),
  responsibilities: optionalText(10000),
  candidateRequirements: optionalText(10000),
  benefits: optionalText(5000),
  applicationProcess: optionalText(5000),
  fees: optionalText(2000),
  recruiterReference: optionalText(150),
  openingDate: optionalDateString,
  applicationDeadline: optionalDateString,
  expiryAt: optionalDateString,
  source: optionalText(150),
  notes: optionalText(5000),
});
export type JobInput = z.infer<typeof jobSchema>;

export const jobStatusChangeSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(jobStatusValues),
});

export const jobDocumentRequirementSchema = z.object({
  opportunityId: z.string().uuid(),
  documentType: z.string().trim().min(2, "Say what document this is."),
  isMandatory: z.boolean().default(true),
  notes: optionalText(1000),
});
export type JobDocumentRequirementInput = z.infer<typeof jobDocumentRequirementSchema>;

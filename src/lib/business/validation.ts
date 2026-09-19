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

export const applicationSchema = z.object({
  businessId: z.string().uuid().optional(),
  customerId: z.string().uuid("Pick a customer for this application."),
  leadId: z.string().uuid().optional().or(z.literal("")),
  opportunityId: z.string().uuid().optional().or(z.literal("")),
  status: z
    .enum(["draft", "submitted", "under_review", "interview", "accepted", "rejected", "withdrawn"])
    .default("draft"),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;

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

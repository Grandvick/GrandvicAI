import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadInput } from "./validation";
import { logLeadEvent } from "./lead-events";
import { createNotification } from "./notifications";
import { logActivity } from "./audit";
import { shouldNotifyHotLead, buildHotLeadNotification } from "./hot-lead";

export type LeadListItem = {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  service: string | null;
  targetCountry: string | null;
  source: string | null;
  stage: string;
  score: number;
  temperature: "hot" | "warm" | "nurture";
  assignedTo: string | null;
  assignedToName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type LeadRow = {
  id: string;
  business_id: string;
  customer_id: string;
  service: string | null;
  target_country: string | null;
  source: string | null;
  stage: string;
  score: number;
  temperature: string;
  assigned_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  customers: { full_name: string; phone: string | null } | null;
  assignee: { full_name: string | null } | null;
};

const LEAD_SELECT =
  "id, business_id, customer_id, service, target_country, source, stage, score, temperature, assigned_to, is_active, created_at, updated_at, customers:customer_id (full_name, phone), assignee:assigned_to (full_name)";

function mapLead(row: LeadRow): LeadListItem {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    customerName: row.customers?.full_name ?? "Unknown customer",
    customerPhone: row.customers?.phone ?? null,
    service: row.service,
    targetCountry: row.target_country,
    source: row.source,
    stage: row.stage,
    score: row.score,
    temperature: row.temperature as LeadListItem["temperature"],
    assignedTo: row.assigned_to,
    assignedToName: row.assignee?.full_name ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listLeads(
  supabase: SupabaseClient,
  businessId: string,
  opts: { stage?: string; temperature?: string; search?: string; activeOnly?: boolean } = {}
): Promise<LeadListItem[]> {
  let query = supabase
    .from("leads")
    .select(LEAD_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (opts.stage) query = query.eq("stage", opts.stage);
  if (opts.temperature) query = query.eq("temperature", opts.temperature);
  if (opts.activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw error;

  let leads = (data ?? []).map((r) => mapLead(r as unknown as LeadRow));

  if (opts.search) {
    const term = opts.search.trim().toLowerCase();
    if (term) {
      leads = leads.filter(
        (l) =>
          l.customerName.toLowerCase().includes(term) ||
          (l.service ?? "").toLowerCase().includes(term) ||
          (l.targetCountry ?? "").toLowerCase().includes(term)
      );
    }
  }

  return leads;
}

export async function getLead(supabase: SupabaseClient, id: string): Promise<LeadListItem | null> {
  const { data, error } = await supabase.from("leads").select(LEAD_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapLead(data as unknown as LeadRow);
}

export async function createLead(
  supabase: SupabaseClient,
  businessId: string,
  createdBy: string,
  input: LeadInput
): Promise<string> {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      business_id: businessId,
      module_id: input.moduleId || null,
      customer_id: input.customerId,
      service: input.service || null,
      target_country: input.targetCountry || null,
      source: input.source || null,
      stage: input.stage,
      score: input.score,
      temperature: input.temperature,
      assigned_to: input.assignedTo || null,
    })
    .select("id")
    .single();

  if (error) throw error;
  const leadId = data.id as string;

  await logLeadEvent(supabase, {
    leadId,
    eventType: "created",
    payload: { stage: input.stage, temperature: input.temperature, score: input.score },
    createdBy,
  });
  await logActivity(supabase, {
    businessId,
    actorId: createdBy,
    action: "lead.created",
    objectType: "lead",
    objectId: leadId,
  });

  if (shouldNotifyHotLead(undefined, input.temperature)) {
    await notifyHotLead(supabase, businessId, leadId);
  }

  return leadId;
}

/**
 * Updates a lead's pipeline/scoring fields. Diffs against the previous row
 * so we only log the fields that actually changed (spec section 15 — "every
 * important interaction should create an activity entry" — not a wall of
 * no-op events), and fires the hot-lead notification exactly on the
 * nurture/warm → hot transition, never on every save.
 */
export async function updateLeadPipeline(
  supabase: SupabaseClient,
  leadId: string,
  updatedBy: string,
  changes: {
    stage?: string;
    score?: number;
    temperature?: "hot" | "warm" | "nurture";
    assignedTo?: string | null;
  }
): Promise<void> {
  const { data: before, error: beforeError } = await supabase
    .from("leads")
    .select("business_id, stage, score, temperature, assigned_to, customers:customer_id (full_name), service, target_country")
    .eq("id", leadId)
    .single();
  if (beforeError) throw beforeError;

  const update: Record<string, unknown> = {};
  if (changes.stage !== undefined && changes.stage !== before.stage) update.stage = changes.stage;
  if (changes.score !== undefined && changes.score !== before.score) update.score = changes.score;
  if (changes.temperature !== undefined && changes.temperature !== before.temperature)
    update.temperature = changes.temperature;
  if (changes.assignedTo !== undefined && changes.assignedTo !== before.assigned_to)
    update.assigned_to = changes.assignedTo;

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase.from("leads").update(update).eq("id", leadId);
  if (error) throw error;

  const businessId = before.business_id as string;

  for (const [field, value] of Object.entries(update)) {
    await logLeadEvent(supabase, {
      leadId,
      eventType: `${field}_changed`,
      payload: { from: (before as Record<string, unknown>)[field === "assigned_to" ? "assigned_to" : field], to: value },
      createdBy: updatedBy,
    });
  }

  await logActivity(supabase, {
    businessId,
    actorId: updatedBy,
    action: "lead.updated",
    objectType: "lead",
    objectId: leadId,
    metadata: update,
  });

  if (
    typeof update.temperature === "string" &&
    shouldNotifyHotLead(before.temperature as string, update.temperature)
  ) {
    await notifyHotLead(supabase, businessId, leadId);
  }
}

export async function addLeadNote(
  supabase: SupabaseClient,
  leadId: string,
  createdBy: string,
  note: string
): Promise<void> {
  await logLeadEvent(supabase, { leadId, eventType: "note_added", payload: { note }, createdBy });
}

async function notifyHotLead(supabase: SupabaseClient, businessId: string, leadId: string) {
  const { data: lead } = await supabase
    .from("leads")
    .select("score, service, target_country, customers:customer_id (full_name)")
    .eq("id", leadId)
    .single();

  if (!lead) return;

  const customerName =
    (lead.customers as unknown as { full_name: string } | null)?.full_name ?? "Unknown customer";

  const { title, body, level } = buildHotLeadNotification({
    customerName,
    service: lead.service as string | null,
    targetCountry: lead.target_country as string | null,
    score: lead.score as number,
  });

  await createNotification(supabase, {
    businessId,
    level,
    title,
    body,
    relatedType: "lead",
    relatedId: leadId,
  });
}

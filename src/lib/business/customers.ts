import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerInput } from "./validation";
import { logActivity } from "./audit";

export type CustomerListItem = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  country: string | null;
  profession: string | null;
  createdAt: string;
  leadCount: number;
};

export type CustomerDetail = CustomerListItem & {
  businessId: string;
  notes: string | null;
  updatedAt: string;
};

export async function listCustomers(
  supabase: SupabaseClient,
  businessId: string,
  opts: { search?: string } = {}
): Promise<CustomerListItem[]> {
  let query = supabase
    .from("customers")
    .select("id, full_name, phone, email, country, profession, created_at, leads(count)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (opts.search) {
    const term = opts.search.trim();
    if (term) {
      query = query.or(
        `full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((c) => ({
    id: c.id as string,
    fullName: c.full_name as string,
    phone: c.phone as string | null,
    email: c.email as string | null,
    country: c.country as string | null,
    profession: c.profession as string | null,
    createdAt: c.created_at as string,
    leadCount: Array.isArray(c.leads) && c.leads[0] ? (c.leads[0] as { count: number }).count : 0,
  }));
}

/**
 * Strips everything from a phone number except its digits — spaces,
 * dashes, dots, parentheses, and a leading "+" are all formatting, not
 * part of the number. This deliberately does NOT touch or guess at the
 * country code itself: "+254 799 999 911", "254799999911", and
 * "(254) 799-999-911" all normalize to the same "254799999911" (same
 * number, different formatting), but a Kenyan "254799999911" and a
 * differently-coded number that happens to share the same trailing digits
 * (e.g. a different country's "1799999911") normalize to DIFFERENT
 * strings and are correctly never treated as equal. Exported so
 * `find_customer_by_contact`'s test coverage — and anywhere else that
 * needs "is this the same phone number, formatting aside" — can reuse the
 * exact same rule rather than re-implementing it slightly differently.
 */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[^\d]/g, "");
}

/**
 * Finds existing customers by an exact phone or email match (Phase 4 spec
 * section 4 — customer identification for the AI Sales Agent). Returns every
 * match rather than picking one, so the caller (the `find_customer_by_contact`
 * AI tool) can tell "no match" (safe to create) from "exactly one match"
 * (safe to reuse) from "more than one match" (ambiguous — spec section 4
 * says to ask the customer for clarification or flag for human review,
 * never guess). Deliberately does NOT fuzzy-match on name — only the two
 * identifiers spec section 4 names as safe: phone and email.
 *
 * Live-testing follow-up: phone matching used to be a raw column-level
 * `.eq()`, which meant "+254799999911", "254799999911", and
 * "254 799 999 911" were treated as three different numbers even though
 * they're the same one, just typed/stored with different formatting —
 * this silently broke customer lookups whenever a channel (or a staff
 * member typing into a form) didn't format a number identically to how it
 * was first stored. Phone matching is now done with `normalizePhone` in
 * application code instead (a computed comparison can't be pushed into a
 * plain `.eq()`), while still never stripping or guessing at the country
 * code — a genuinely different number is never treated as a match. Email
 * matching is unaffected: it's still an exact, case-insensitive equality
 * check at the database level, which needs no such normalization.
 */
export async function findCustomerByContact(
  supabase: SupabaseClient,
  businessId: string,
  contact: { phone?: string; email?: string }
): Promise<CustomerListItem[]> {
  const phone = contact.phone?.trim();
  const email = contact.email?.trim().toLowerCase();
  if (!phone && !email) return [];

  const normalizedPhone = phone ? normalizePhone(phone) : undefined;

  let query = supabase
    .from("customers")
    .select("id, full_name, phone, email, country, profession, created_at, leads(count)")
    .eq("business_id", businessId);

  // Email keeps its exact, efficient database-level match. Phone can't be
  // matched that way anymore (see above), so whenever a phone is given,
  // this only narrows by email (if also given) at the database level and
  // leaves phone matching entirely to the final filter below, which
  // applies `normalizePhone` to every business customer's stored phone —
  // this business's customer list is small enough that this is a
  // perfectly cheap trade-off, and it's the same "fetch broader, refine
  // in application code" approach already used for the knowledge-base
  // search fix (see src/lib/business/knowledge.ts).
  if (email && !normalizedPhone) {
    query = query.eq("email", email);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  const candidates = (data ?? []).map((c) => ({
    id: c.id as string,
    fullName: c.full_name as string,
    phone: c.phone as string | null,
    email: c.email as string | null,
    country: c.country as string | null,
    profession: c.profession as string | null,
    createdAt: c.created_at as string,
    leadCount: Array.isArray(c.leads) && c.leads[0] ? (c.leads[0] as { count: number }).count : 0,
  }));

  return candidates.filter((c) => {
    const emailMatches = !!email && !!c.email && c.email.toLowerCase() === email;
    const phoneMatches = !!normalizedPhone && !!c.phone && normalizePhone(c.phone) === normalizedPhone;
    return emailMatches || phoneMatches;
  });
}

export async function getCustomer(
  supabase: SupabaseClient,
  id: string
): Promise<CustomerDetail | null> {
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, business_id, full_name, phone, email, country, profession, notes, created_at, updated_at, leads(count)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    businessId: data.business_id as string,
    fullName: data.full_name as string,
    phone: data.phone as string | null,
    email: data.email as string | null,
    country: data.country as string | null,
    profession: data.profession as string | null,
    notes: data.notes as string | null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    leadCount: Array.isArray(data.leads) && data.leads[0] ? (data.leads[0] as { count: number }).count : 0,
  };
}

export async function createCustomer(
  supabase: SupabaseClient,
  businessId: string,
  createdBy: string | null,
  input: CustomerInput
): Promise<string> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      business_id: businessId,
      full_name: input.fullName,
      phone: input.phone || null,
      email: input.email || null,
      country: input.country || null,
      profession: input.profession || null,
      notes: input.notes || null,
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error) throw error;
  const customerId = data.id as string;

  await logActivity(supabase, {
    businessId,
    actorId: createdBy,
    // Phase 5F (Phase 5 plan, section I's "Audit trail" requirement): a
    // null actor is a system/webhook-triggered write (see AiToolContext.
    // userId's doc comment) — this codebase has no other reason a create*
    // call ever gets a null actor, so the two are equivalent here, not
    // just usually correlated. Without this, a real WhatsApp customer
    // created by an unattended webhook would show as actor_type: "user"
    // with a null actor_id in the audit log — indistinguishable from a
    // bug, rather than clearly a system action.
    actorType: createdBy === null ? "system" : "user",
    action: "customer.created",
    objectType: "customer",
    objectId: customerId,
  });

  return customerId;
}

export async function updateCustomer(
  supabase: SupabaseClient,
  id: string,
  input: CustomerInput,
  updatedBy?: string
): Promise<void> {
  const { data, error } = await supabase
    .from("customers")
    .update({
      full_name: input.fullName,
      phone: input.phone || null,
      email: input.email || null,
      country: input.country || null,
      profession: input.profession || null,
      notes: input.notes || null,
    })
    .eq("id", id)
    .select("business_id")
    .single();

  if (error) throw error;

  await logActivity(supabase, {
    businessId: data.business_id as string,
    actorId: updatedBy ?? null,
    action: "customer.updated",
    objectType: "customer",
    objectId: id,
  });
}

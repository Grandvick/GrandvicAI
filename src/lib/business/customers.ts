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
  createdBy: string,
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

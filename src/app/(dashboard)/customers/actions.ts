"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { customerSchema } from "@/lib/business/validation";
import { createCustomer, updateCustomer } from "@/lib/business/customers";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function readCustomerForm(formData: FormData) {
  return {
    fullName: String(formData.get("fullName") || ""),
    phone: String(formData.get("phone") || ""),
    email: String(formData.get("email") || ""),
    country: String(formData.get("country") || ""),
    profession: String(formData.get("profession") || ""),
    notes: String(formData.get("notes") || ""),
  };
}

export async function createCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = customerSchema.safeParse(readCustomerForm(formData));
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

  let customerId: string;
  try {
    customerId = await createCustomer(supabase, businessId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create customer." };
  }

  revalidatePath("/customers");
  redirect(`/customers/${customerId}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = customerSchema.safeParse(readCustomerForm(formData));
  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const { supabase, user } = await requireCurrentUser();

  try {
    await updateCustomer(supabase, customerId, parsed.data, user.userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update customer." };
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { error: undefined };
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

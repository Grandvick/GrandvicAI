import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CurrentUser = {
  userId: string;
  email: string;
  fullName: string | null;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  /** null for the Owner (who can see every business); set for scoped staff. */
  businessId: string | null;
};

type ProfileRow = {
  full_name: string | null;
  business_id: string | null;
  roles: { key: string; name: string } | null;
};

/**
 * Resolves the signed-in user + their role/business scope. Used by every
 * Phase 1 server action (mutations run standalone, outside the
 * (dashboard) layout's redirect-if-signed-out guard, so each one re-checks).
 * Pages under (dashboard) can also call this to render role-aware UI.
 *
 * Redirects to /login if there is no session — callers can treat the
 * return value as always populated.
 */
export async function requireCurrentUser(): Promise<{
  supabase: SupabaseClient;
  user: CurrentUser;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, business_id, roles:role_id (key, name)")
    .eq("id", user.id)
    .maybeSingle();

  const p = profile as ProfileRow | null;
  const roleKey = p?.roles?.key ?? "owner";

  return {
    supabase,
    user: {
      userId: user.id,
      email: user.email ?? "",
      fullName: p?.full_name ?? null,
      roleKey,
      roleName: p?.roles?.name ?? "Owner",
      isOwner: roleKey === "owner",
      businessId: p?.business_id ?? null,
    },
  };
}

/**
 * Resolves which business_id a new record should be written against.
 *
 * Scoped staff always write to their assigned business. The Owner isn't
 * pinned to one business (they can see all of them), so for a create form
 * we either use the business_id the form explicitly submitted (a real
 * dropdown, once more than one business exists) or fall back to the first
 * business row — there's only one (Grandvic Tours & Travel) today, but
 * nothing here hard-codes that; adding a second business and a business
 * switcher in the UI is enough to change this.
 */
export async function resolveBusinessId(
  supabase: SupabaseClient,
  user: CurrentUser,
  requestedBusinessId?: string | null
): Promise<string> {
  if (!user.isOwner) {
    if (!user.businessId) {
      throw new Error("Your account isn't assigned to a business yet. Ask the owner to assign one in Settings.");
    }
    return user.businessId;
  }

  if (requestedBusinessId) {
    return requestedBusinessId;
  }

  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("No business exists yet. Create one first (see Settings).");
  }

  return data.id as string;
}

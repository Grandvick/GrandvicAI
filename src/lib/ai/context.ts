import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUserOrNull, resolveBusinessId, type CurrentUser } from "@/lib/business/context";
import { listBusinessModules } from "@/lib/business/businesses";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { AiAuthError, AiBusinessContextError } from "./errors";
import type { AiToolContext } from "./types";

export type AiRequestContext = {
  supabase: SupabaseClient;
  user: CurrentUser;
  businessId: string;
  businessName: string;
  availableModules: string[];
  now: Date;
};

/**
 * Resolves everything one AI Command Center request needs to know before it
 * can do anything (spec section 5): who's asking, their role, which
 * business they're scoped to, and what modules that business has enabled —
 * all through the SAME `requireCurrentUser`/`resolveBusinessId` scope
 * resolution every other page and Server Action already uses, and the SAME
 * RLS-scoped Supabase client (never the service-role client — see
 * src/lib/ai/tools/registry.ts and ARCHITECTURE.md section 10).
 *
 * Deliberately does NOT assume `profile.business_id` is populated — an
 * Owner resolves their business via `resolveBusinessId()` exactly like
 * every Jobs/Customers/Leads page does, so this works unchanged once a
 * second business (e.g. a future Grandvic Motors) exists and an Owner can
 * pick one.
 *
 * Throws AiAuthError if there's no session, AiBusinessContextError if a
 * business can't be resolved (e.g. brand-new staff account with no
 * assignment yet) — both carry a `userMessage` safe to show directly in the
 * AI Command Center.
 */
export async function resolveAiRequestContext(): Promise<AiRequestContext> {
  const session = await getCurrentUserOrNull();
  if (!session) throw new AiAuthError();
  const { supabase, user } = session;

  let businessId: string;
  try {
    businessId = await resolveBusinessId(supabase, user);
  } catch {
    throw new AiBusinessContextError(
      user.isOwner
        ? "No business exists yet. Create one first (see Settings)."
        : "Your account isn't assigned to a business yet. Ask the owner to assign one in Settings."
    );
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();

  const [modules] = await Promise.all([listBusinessModules(supabase, businessId)]);

  return {
    supabase,
    user,
    businessId,
    businessName: (business?.name as string | undefined) ?? "your business",
    availableModules: modules.map((m) => m.name),
    now: new Date(),
  };
}

export function toToolContext(ctx: AiRequestContext, conversationId: string | null = null): AiToolContext {
  return {
    supabase: ctx.supabase,
    userId: ctx.user.userId,
    roleKey: ctx.user.roleKey,
    isOwner: ctx.user.isOwner,
    businessId: ctx.businessId,
    businessName: ctx.businessName,
    now: ctx.now,
    conversationId,
  };
}

/**
 * The non-session counterpart to resolveAiRequestContext()/toToolContext()
 * (Phase 5C — Phase 5 plan, section B/H). A future WhatsApp webhook has no
 * signed-in Supabase Auth session for `getCurrentUserOrNull()` to resolve —
 * Meta authenticates a webhook request with an HMAC signature, not a
 * cookie — so `businessId` here comes from resolving the webhook's
 * `phone_number_id` against `whatsapp_business_accounts` (Phase 5F, not yet
 * built), not from a session.
 *
 * Because there is no session, this uses the service-role Supabase client
 * (`createSupabaseServiceRoleClient`, src/lib/supabase/server.ts — already
 * provisioned for exactly this "webhook handlers verifying external events"
 * case, previously unused) instead of the RLS-scoped one every other AI
 * request uses. RLS is not enforcing business scope for calls made through
 * this context, so every write tool that runs under it MUST continue to
 * pass through the caller-supplied `businessId` only — see
 * src/lib/ai/tools/write.ts's existing rule that no tool ever accepts a
 * businessId argument from the model — and never trust anything from the
 * inbound payload for scoping.
 *
 * `userId: null` marks this as a system/service actor rather than a signed-
 * in staff member (see AiToolContext.userId's doc comment) — every business-
 * logic function a write tool can reach already accepts a nullable actor id
 * for exactly this reason (Phase 5C).
 *
 * Throws AiBusinessContextError if `businessId` doesn't resolve to a real
 * business — the caller (the future webhook route) should treat that as a
 * configuration problem (an unmapped phone_number_id), not process the
 * message as if no business were involved.
 */
export async function toSystemToolContext(
  businessId: string,
  conversationId: string | null
): Promise<AiToolContext> {
  const supabase = await createSupabaseServiceRoleClient();

  const { data: business, error } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw error;
  if (!business) {
    throw new AiBusinessContextError(`No business found for id "${businessId}".`);
  }

  return {
    supabase,
    userId: null,
    roleKey: "system",
    isOwner: false,
    businessId,
    businessName: (business.name as string | undefined) ?? "your business",
    now: new Date(),
    conversationId,
  };
}

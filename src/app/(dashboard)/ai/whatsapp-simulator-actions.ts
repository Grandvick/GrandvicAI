"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { orchestrateInboundWhatsAppMessage } from "@/lib/channels/whatsapp/orchestrate";

/**
 * Phase 5D — the dev-only "simulate inbound WhatsApp message" Server Action
 * (Phase 5 plan, section K/N). Deliberately the ONLY caller of
 * orchestrateInboundWhatsAppMessage until Phase 5F builds the real webhook
 * route — there is still no real Meta connection anywhere in this app.
 *
 * A signed-in staff member plays the role of Meta's webhook here (typing a
 * phone number + message instead of a real customer's device sending one),
 * exactly the same "staff plays the other side" pattern
 * createSalesAgentConversation's website-channel simulator already uses.
 * requireCurrentUser()/resolveBusinessId() resolve which business this
 * staff member is testing as — the orchestration function itself has no
 * session and does not need one (it uses the service-role client via
 * toSystemToolContext, the same path a real webhook will use).
 */
export type SimulateInboundWhatsAppMessageResult = Awaited<ReturnType<typeof orchestrateInboundWhatsAppMessage>>;

export async function simulateInboundWhatsAppMessageAction(
  fromPhone: string,
  text: string
): Promise<SimulateInboundWhatsAppMessageResult> {
  const { supabase, user } = await requireCurrentUser();

  let businessId: string;
  try {
    businessId = await resolveBusinessId(supabase, user);
  } catch {
    return {
      ok: false,
      error: user.isOwner
        ? "No business exists yet. Create one first (see Settings)."
        : "Your account isn't assigned to a business yet. Ask the owner to assign one in Settings.",
      conversationId: null,
    };
  }

  const result = await orchestrateInboundWhatsAppMessage({ businessId, fromPhone, text });

  // Mirrors the takeover actions in sales-agent-actions.ts: revalidate so
  // /inbox (once Phase 5E exists) and any other view of this conversation
  // reflect the new message/state immediately.
  revalidatePath("/ai");

  return result;
}

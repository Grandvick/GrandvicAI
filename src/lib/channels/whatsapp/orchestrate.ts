import "server-only";
import { runAiChat } from "@/lib/ai/core";
import { getAiProvider } from "@/lib/ai/provider";
import { toSystemToolContext } from "@/lib/ai/context";
import { buildSalesAgentPrompt } from "@/lib/ai/prompts/sales-agent";
import { logAiRun, summarizeToolCalls } from "@/lib/ai/logging";
import { toAiError } from "@/lib/ai/errors";
import { evaluateOwnerNotifications } from "@/lib/ai/sales/notifications";
import {
  appendConversationMessage,
  createOrGetWhatsAppConversation,
  getConversationState,
  conversationAcceptsAiReplies,
  listConversationMessages,
  type ConversationMode,
} from "@/lib/business/conversations";
import { listConversationEvents, type ConversationEvent } from "@/lib/business/conversation-events";
import { createNotification } from "@/lib/business/notifications";
import { findCustomerByContact, createCustomer, getCustomer, normalizePhone } from "@/lib/business/customers";
import { buildConversationPublicState, type ConversationPublicState } from "@/lib/business/conversation-public-state";
import { getWhatsAppProvider } from "./provider";
import { WhatsAppSendError } from "./errors";
import type { AiChatMessage } from "@/lib/ai/types";

export type OrchestrateInboundWhatsAppMessageParams = {
  businessId: string;
  /** The customer's WhatsApp number as delivered by the channel — normalized internally via normalizePhone (src/lib/business/customers.ts) before it's used as a lookup key or a thread identity, so formatting differences never split one customer into two. */
  fromPhone: string;
  text: string;
  /** The channel's own id for this inbound message (Meta's `wamid`, once a real webhook exists — Phase 5F). Optional here because the dev-only simulator (Phase 5D) has no such id; when given, it's recorded on the persisted inbound row for future dedup, but no dedup check runs in this function — that is the webhook layer's job (Phase 5F, via whatsapp_webhook_events), not the orchestration layer's. */
  externalId?: string | null;
};

export type OrchestrateInboundWhatsAppMessageResult =
  | {
      ok: true;
      aiResponded: true;
      reply: string;
      toolCalls: { name: string; ok: boolean }[];
      conversationId: string;
      conversation: ConversationPublicState;
      events: ConversationEvent[];
      model: string;
      send: { externalId: string; status: string };
    }
  | {
      ok: true;
      aiResponded: false;
      /** Why the AI didn't reply — the human-takeover gate (conversationAcceptsAiReplies), same as the website route. No WhatsApp message is sent in this case, matching that no AI reply is sent on the website channel either. */
      reason: Exclude<ConversationMode, "ai">;
      conversationId: string;
      conversation: ConversationPublicState;
      events: ConversationEvent[];
    }
  | {
      ok: false;
      error: string;
      conversationId: string | null;
    };

/**
 * The WhatsApp channel orchestration layer (Phase 5D — Phase 5 plan,
 * section B/K). A thin adapter around the exact same channel-agnostic
 * engine src/app/api/ai/sales-agent/route.ts already uses
 * (toSystemToolContext -> runAiChat -> buildSalesAgentPrompt) — this
 * function differs from that route only in how it resolves WHO is talking
 * (a phone number instead of a signed-in session, via
 * toSystemToolContext/createOrGetWhatsAppConversation) and in sending its
 * reply back out (via the WhatsAppProvider abstraction) instead of
 * returning it in an HTTP response body. The AI Sales Agent itself
 * (runAiChat, the tool registry, buildSalesAgentPrompt) is never made
 * aware that WhatsApp exists — nothing under src/lib/ai/** imports
 * anything from src/lib/channels/whatsapp/**, only the reverse.
 *
 * Phase 5D's ONLY caller is the dev-only "simulate inbound WhatsApp
 * message" panel on the dashboard's /ai page — there is no real webhook
 * yet (Phase 5F). This function is written so that stays true when the
 * real webhook route is added later: the webhook's own job will be to
 * verify Meta's signature, dedup via whatsapp_webhook_events, resolve
 * phone_number_id -> businessId via whatsapp_business_accounts, and then
 * call this exact function — nothing in here changes.
 *
 * Never throws — every failure path (a config problem, a provider error, a
 * database error) is caught and returned as `{ ok: false, error }`, since
 * there is no HTTP response for a caller to shape an error status code
 * around; the caller (today: a dev-only Server Action) decides how to
 * surface `error` to the person testing it.
 */
export async function orchestrateInboundWhatsAppMessage(
  params: OrchestrateInboundWhatsAppMessageParams
): Promise<OrchestrateInboundWhatsAppMessageResult> {
  const startedAt = Date.now();
  const { businessId, text } = params;
  const normalizedPhone = normalizePhone(params.fromPhone);

  let conversationId: string | null = null;

  try {
    const toolContext = await toSystemToolContext(businessId, null);
    const { supabase } = toolContext;

    // Customer identification (spec section 4, same rule the AI's
    // find_customer_by_contact tool uses): reuse an existing customer with
    // this exact phone number; only create a new one when there is exactly
    // zero matches. More than one match is left alone here (ambiguous,
    // ai/tools/read-only.ts's tool is where that's normally surfaced to the
    // model) — the conversation is still created either way via
    // createOrGetWhatsAppConversation, which does not require a customerId.
    const candidates = await findCustomerByContact(supabase, businessId, { phone: normalizedPhone });
    let customerId: string | null = candidates.length === 1 ? candidates[0].id : null;
    if (candidates.length === 0) {
      customerId = await createCustomer(supabase, businessId, null, {
        fullName: `WhatsApp ${normalizedPhone}`,
        phone: normalizedPhone,
      });
    }

    conversationId = await createOrGetWhatsAppConversation(supabase, businessId, normalizedPhone, {
      customerId,
    });

    const before = await getConversationState(supabase, conversationId);
    if (!before) {
      return { ok: false, error: "Conversation could not be loaded.", conversationId };
    }

    const priorMessages = await listConversationMessages(supabase, conversationId, { limit: 20 });
    const history: AiChatMessage[] = priorMessages.map((m) => ({
      role: m.senderType === "ai" ? "assistant" : "user",
      content: m.content,
    }));

    try {
      await appendConversationMessage(supabase, conversationId, "customer", text, null, {
        externalId: params.externalId ?? undefined,
        direction: "inbound",
      });
    } catch (err) {
      console.error("[whatsapp:orchestrate] conversation persistence failed", err);
    }

    // Human takeover hard gate (spec section 16) — shared with every other
    // inbound-message entry point via conversationAcceptsAiReplies (Phase
    // 5C). No WhatsApp send happens on this path: a human has taken over or
    // the AI has paused itself, so there is nothing for the AI to say.
    if (!conversationAcceptsAiReplies(before)) {
      return {
        ok: true,
        aiResponded: false,
        reason: before.mode as Exclude<ConversationMode, "ai">,
        conversationId,
        conversation: await buildConversationPublicState(supabase, before),
        events: await listConversationEvents(supabase, conversationId, { limit: 10 }).catch(() => []),
      };
    }

    // toSystemToolContext(businessId, null) above was resolved before this
    // conversation existed/was found — re-shape it with the now-known
    // conversationId (mirrors toToolContext's conversationId param in
    // src/lib/ai/context.ts) so write tools like add_conversation_event can
    // target it, without a second business lookup round-trip.
    const scopedToolContext = { ...toolContext, conversationId };
    const systemPrompt = buildSalesAgentPrompt(scopedToolContext, before);

    const provider = getAiProvider();
    const result = await runAiChat({
      provider,
      toolContext: scopedToolContext,
      systemPrompt,
      history,
      userMessage: text,
    });

    try {
      await appendConversationMessage(supabase, conversationId, "ai", result.reply, null, {
        direction: "outbound",
      });
    } catch (err) {
      console.error("[whatsapp:orchestrate] conversation persistence failed", err);
    }

    const after = (await getConversationState(supabase, conversationId)) ?? before;

    try {
      const customerName = after.customerId ? (await getCustomer(supabase, after.customerId))?.fullName : null;
      const notifications = evaluateOwnerNotifications({
        toolCalls: result.toolCalls,
        before,
        after,
        customerName,
      });
      for (const n of notifications) {
        await createNotification(supabase, {
          businessId,
          level: n.level,
          title: n.title,
          body: n.body,
          relatedType: n.relatedType,
          relatedId: n.relatedId,
        });
      }
    } catch (err) {
      console.error("[whatsapp:orchestrate] owner notification failed", err);
    }

    await logAiRun(supabase, {
      businessId,
      userId: null,
      runType: "sales_agent",
      input: { message: text, historyLength: history.length },
      output: { reply: result.reply, toolCalls: summarizeToolCalls(result.toolCalls) },
      model: result.model,
      tokensInput: result.usage.inputTokens,
      tokensOutput: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      status: "success",
    });

    // Outbound send happens last, after everything is safely persisted —
    // if sending fails, the conversation state/transcript/notifications
    // this request produced are still correct and visible in the inbox;
    // only the actual WhatsApp delivery is what's reported as failed.
    let send: { externalId: string; status: string };
    try {
      const whatsAppProvider = getWhatsAppProvider();
      const sendResult = await whatsAppProvider.sendText({ to: normalizedPhone, body: result.reply });
      send = sendResult;
    } catch (err) {
      const sendErr =
        err instanceof WhatsAppSendError ? err : new WhatsAppSendError("Failed to send the WhatsApp reply.", { cause: err });
      console.error("[whatsapp:orchestrate] send failed", sendErr);
      return { ok: false, error: sendErr.userMessage, conversationId };
    }

    return {
      ok: true,
      aiResponded: true,
      reply: result.reply,
      toolCalls: summarizeToolCalls(result.toolCalls),
      conversationId,
      conversation: await buildConversationPublicState(supabase, after),
      events: await listConversationEvents(supabase, conversationId, { limit: 10 }).catch(() => []),
      model: result.model,
      send,
    };
  } catch (err) {
    const aiErr = toAiError(err);
    console.error("[whatsapp:orchestrate] failed", aiErr);
    return { ok: false, error: aiErr.userMessage, conversationId };
  }
}

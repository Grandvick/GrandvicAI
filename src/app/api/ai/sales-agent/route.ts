import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { resolveAiRequestContext, toToolContext } from "@/lib/ai/context";
import { getAiProvider } from "@/lib/ai/provider";
import { runAiChat } from "@/lib/ai/core";
import { buildSalesAgentPrompt } from "@/lib/ai/prompts/sales-agent";
import { salesAgentChatRequestSchema } from "@/lib/ai/validation";
import { checkAndConsumeRateLimit } from "@/lib/ai/rate-limit";
import { logAiRun, summarizeToolCalls } from "@/lib/ai/logging";
import { toAiError } from "@/lib/ai/errors";
import { evaluateOwnerNotifications } from "@/lib/ai/sales/notifications";
import {
  appendConversationMessage,
  createSalesAgentConversation,
  getSalesAgentConversation,
  getConversationState,
  listConversationMessages,
  conversationAcceptsAiReplies,
} from "@/lib/business/conversations";
import { listConversationEvents } from "@/lib/business/conversation-events";
import { createNotification } from "@/lib/business/notifications";
import { getCustomer } from "@/lib/business/customers";
import { buildConversationPublicState } from "@/lib/business/conversation-public-state";
import type { AiChatMessage } from "@/lib/ai/types";

// Session/live-database-dependent — never statically prerendered (same
// reasoning as /api/ai/chat and every (dashboard) page).
export const dynamic = "force-dynamic";

/**
 * The channel-agnostic AI Sales Agent conversation engine (Phase 4 spec
 * section 2/16). Structurally mirrors /api/ai/chat/route.ts (same auth,
 * rate-limit, provider, logging pattern) with three real differences:
 *
 *   1. Persona/tools: uses prompts/sales-agent.ts instead of
 *      prompts/system.ts, and sets ctx.conversationId so the Phase 4 write
 *      tools (create_lead, update_conversation_state, etc.) can act on this
 *      specific conversation — see src/lib/ai/tools/write.ts.
 *   2. Human takeover hard gate (spec section 16): if the conversation's
 *      mode isn't "ai", the customer's message is still recorded (so a
 *      human sees it), but the AI provider is never called — this is an
 *      actual gate in code, not just a prompt instruction.
 *   3. Owner-visibility notifications (spec section 21) — evaluated once
 *      per request from what actually changed (see sales/notifications.ts).
 *
 * There is no real inbound channel yet in Phase 4 (spec explicitly forbids
 * starting WhatsApp/social) — this endpoint is called today by the
 * dashboard's "AI Sales Agent (test)" panel, with a signed-in staff member
 * playing the customer role, using `channel = 'website'` conversations
 * (see src/lib/business/conversations.ts). Nothing about this endpoint
 * changes when a real website widget or WhatsApp webhook calls it later —
 * they would need their own authentication story, but the conversation
 * engine itself is already channel-agnostic.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();

  // Gates on hasAiProvider, not hasOpenAI directly, so local development
  // works with AI_PROVIDER=mock even without an OpenAI key at all (Phase 4
  // — see src/lib/config.ts and src/lib/ai/provider/index.ts).
  if (!env.hasAiProvider) {
    return NextResponse.json(
      { error: "The AI Sales Agent isn't configured yet. Add OPENAI_API_KEY — see SETUP.md." },
      { status: 503 }
    );
  }

  let ctx;
  try {
    ctx = await resolveAiRequestContext();
  } catch (err) {
    const aiErr = toAiError(err);
    return NextResponse.json({ error: aiErr.userMessage }, { status: aiErr.statusCode });
  }

  // Separate rate-limit budget from the internal Command Centre (spec
  // section 16/27) — a busy sales-agent test session shouldn't exhaust the
  // same staff member's internal-assistant quota, or vice versa.
  const rateLimit = checkAndConsumeRateLimit(`sales:${ctx.user.userId}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `You're sending requests too quickly. Try again in ${rateLimit.retryAfterSeconds}s.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = salesAgentChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { message, conversationId: requestedConversationId, customerId } = parsed.data;

  let conversationId: string;
  try {
    if (requestedConversationId) {
      const existing = await getSalesAgentConversation(ctx.supabase, ctx.businessId, requestedConversationId);
      conversationId =
        existing?.id ?? (await createSalesAgentConversation(ctx.supabase, ctx.businessId, { customerId }));
    } else {
      conversationId = await createSalesAgentConversation(ctx.supabase, ctx.businessId, { customerId });
    }
  } catch (err) {
    const aiErr = toAiError(err);
    return NextResponse.json({ error: aiErr.userMessage }, { status: aiErr.statusCode });
  }

  const before = await getConversationState(ctx.supabase, conversationId);
  if (!before) {
    return NextResponse.json({ error: "Conversation could not be loaded." }, { status: 500 });
  }

  // History is loaded server-side from the persisted transcript (never
  // trusted from the client, unlike the internal Command Centre's `history`
  // param) — bounded for cost control (spec section 27), and fetched BEFORE
  // the new message is appended so it doesn't duplicate `userMessage` below.
  const priorMessages = await listConversationMessages(ctx.supabase, conversationId, { limit: 20 });
  const history: AiChatMessage[] = priorMessages.map((m) => ({
    role: m.senderType === "ai" ? "assistant" : "user",
    content: m.content,
  }));

  try {
    await appendConversationMessage(ctx.supabase, conversationId, "customer", message);
  } catch (err) {
    console.error("[ai:sales-agent] conversation persistence failed", err);
  }

  // Human takeover hard gate (spec section 16) — the AI must not
  // auto-respond once a human has taken over or paused it. Shared with
  // every other inbound-message entry point via conversationAcceptsAiReplies
  // (Phase 5C) — see its doc comment in src/lib/business/conversations.ts.
  if (!conversationAcceptsAiReplies(before)) {
    return NextResponse.json({
      aiResponded: false,
      reason: before.mode,
      conversationId,
      conversation: await buildConversationPublicState(ctx.supabase, before),
      events: await listConversationEvents(ctx.supabase, conversationId, { limit: 10 }).catch(() => []),
    });
  }

  const toolContext = toToolContext(ctx, conversationId);
  const systemPrompt = buildSalesAgentPrompt(toolContext, before);

  try {
    const provider = getAiProvider();
    const result = await runAiChat({ provider, toolContext, systemPrompt, history, userMessage: message });

    try {
      await appendConversationMessage(ctx.supabase, conversationId, "ai", result.reply);
    } catch (err) {
      console.error("[ai:sales-agent] conversation persistence failed", err);
    }

    const after = (await getConversationState(ctx.supabase, conversationId)) ?? before;

    // Owner-visibility notifications (spec section 21) — best-effort, never
    // blocks the response.
    try {
      const customerName = after.customerId ? (await getCustomer(ctx.supabase, after.customerId))?.fullName : null;
      const notifications = evaluateOwnerNotifications({
        toolCalls: result.toolCalls,
        before,
        after,
        customerName,
      });
      for (const n of notifications) {
        await createNotification(ctx.supabase, {
          businessId: ctx.businessId,
          level: n.level,
          title: n.title,
          body: n.body,
          relatedType: n.relatedType,
          relatedId: n.relatedId,
        });
      }
    } catch (err) {
      console.error("[ai:sales-agent] owner notification failed", err);
    }

    await logAiRun(ctx.supabase, {
      businessId: ctx.businessId,
      userId: ctx.user.userId,
      runType: "sales_agent",
      input: { message, historyLength: history.length },
      output: { reply: result.reply, toolCalls: summarizeToolCalls(result.toolCalls) },
      model: result.model,
      tokensInput: result.usage.inputTokens,
      tokensOutput: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      status: "success",
    });

    return NextResponse.json({
      aiResponded: true,
      reply: result.reply,
      toolCalls: summarizeToolCalls(result.toolCalls),
      conversationId,
      conversation: await buildConversationPublicState(ctx.supabase, after),
      events: await listConversationEvents(ctx.supabase, conversationId, { limit: 10 }).catch(() => []),
      model: result.model,
    });
  } catch (err) {
    const aiErr = toAiError(err);

    await logAiRun(ctx.supabase, {
      businessId: ctx.businessId,
      userId: ctx.user.userId,
      runType: "sales_agent",
      input: { message, historyLength: history.length },
      output: { reply: "", toolCalls: [] },
      model: null,
      tokensInput: null,
      tokensOutput: null,
      latencyMs: Date.now() - startedAt,
      status: aiErr.statusCode === 429 ? "blocked" : "error",
      errorMessage: aiErr.userMessage,
    });

    return NextResponse.json({ error: aiErr.userMessage, conversationId }, { status: aiErr.statusCode });
  }
}

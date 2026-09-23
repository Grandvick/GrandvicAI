import { NextResponse } from "next/server";
import { env } from "@/lib/config";
import { resolveAiRequestContext, toToolContext } from "@/lib/ai/context";
import { getAiProvider } from "@/lib/ai/provider";
import { runAiChat } from "@/lib/ai/core";
import { buildSystemPrompt } from "@/lib/ai/prompts/system";
import { aiChatRequestSchema } from "@/lib/ai/validation";
import { checkAndConsumeRateLimit } from "@/lib/ai/rate-limit";
import { logAiRun, summarizeToolCalls } from "@/lib/ai/logging";
import { toAiError } from "@/lib/ai/errors";
import {
  appendConversationMessage,
  createDashboardConversation,
  getDashboardConversation,
} from "@/lib/business/conversations";

// This endpoint depends on the signed-in session and live database state —
// never statically prerendered (same reasoning as every (dashboard) page).
export const dynamic = "force-dynamic";

/**
 * The AI Core's server-side entry point (spec section 8). Flow:
 *   1. authenticate the request
 *   2. resolve user + business context (never assumes profile.business_id
 *      is populated for an Owner — see src/lib/ai/context.ts)
 *   3. rate-limit
 *   4. persist the user's message to conversations/conversation_messages
 *   5. run the bounded tool-calling loop (src/lib/ai/core.ts)
 *   6. persist the AI's reply
 *   7. log the run to ai_runs
 *   8. return a small, structured JSON response — never a stack trace or
 *      raw provider/database error (spec section 14/19)
 */
export async function POST(request: Request) {
  const startedAt = Date.now();

  // Gates on hasAiProvider, not hasOpenAI directly, so local development
  // works with AI_PROVIDER=mock even without an OpenAI key at all (Phase 4
  // — see src/lib/config.ts and src/lib/ai/provider/index.ts).
  if (!env.hasAiProvider) {
    return NextResponse.json(
      { error: "The AI assistant isn't configured yet. Add OPENAI_API_KEY — see SETUP.md." },
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

  const rateLimit = checkAndConsumeRateLimit(ctx.user.userId);
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

  const parsed = aiChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }
  const { message, history, conversationId: requestedConversationId } = parsed.data;

  // Resolve (and validate ownership of) the conversation thread, or start a
  // new one — see src/lib/business/conversations.ts.
  let conversationId: string | null = null;
  try {
    if (requestedConversationId) {
      const existing = await getDashboardConversation(ctx.supabase, ctx.businessId, requestedConversationId);
      conversationId = existing?.id ?? (await createDashboardConversation(ctx.supabase, ctx.businessId, ctx.user.userId));
    } else {
      conversationId = await createDashboardConversation(ctx.supabase, ctx.businessId, ctx.user.userId);
    }
    await appendConversationMessage(ctx.supabase, conversationId, "staff", message, ctx.user.userId);
  } catch (err) {
    // Conversation persistence is best-effort — never block the actual AI
    // answer on it (mirrors logActivity's fire-and-forget-safe pattern).
    console.error("[ai] conversation persistence failed", err);
  }

  const toolContext = toToolContext(ctx);

  try {
    const provider = getAiProvider();
    const result = await runAiChat({
      provider,
      toolContext,
      systemPrompt: buildSystemPrompt(toolContext),
      history,
      userMessage: message,
    });

    if (conversationId) {
      try {
        await appendConversationMessage(ctx.supabase, conversationId, "ai", result.reply);
      } catch (err) {
        console.error("[ai] conversation persistence failed", err);
      }
    }

    await logAiRun(ctx.supabase, {
      businessId: ctx.businessId,
      userId: ctx.user.userId,
      runType: "command_centre",
      input: { message, historyLength: history.length },
      output: { reply: result.reply, toolCalls: summarizeToolCalls(result.toolCalls) },
      model: result.model,
      tokensInput: result.usage.inputTokens,
      tokensOutput: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      status: "success",
    });

    return NextResponse.json({
      reply: result.reply,
      toolCalls: summarizeToolCalls(result.toolCalls),
      conversationId,
      model: result.model,
    });
  } catch (err) {
    const aiErr = toAiError(err);

    await logAiRun(ctx.supabase, {
      businessId: ctx.businessId,
      userId: ctx.user.userId,
      runType: "command_centre",
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

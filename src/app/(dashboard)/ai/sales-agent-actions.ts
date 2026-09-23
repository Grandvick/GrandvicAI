"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/business/context";
import { updateConversationState } from "@/lib/business/conversations";

/**
 * The controlled human-takeover mechanism (Phase 4 spec section 16) — these
 * are STAFF actions (a person clicking a button), never something the AI
 * calls on itself. The AI's own `update_conversation_state` tool
 * (src/lib/ai/tools/write.ts) is explicitly blocked from setting mode back
 * to "ai" for exactly this reason — only a human, through one of these
 * actions, can resume it.
 */

export type SalesAgentActionResult = { error?: string };

export async function takeOverConversationAction(conversationId: string): Promise<SalesAgentActionResult> {
  const { supabase, user } = await requireCurrentUser();
  try {
    await updateConversationState(
      supabase,
      conversationId,
      { id: user.userId, type: "user" },
      { mode: "human", handoverReason: `${user.fullName ?? "A staff member"} took over this conversation.` }
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to take over the conversation." };
  }

  revalidatePath("/ai");
  return {};
}

export async function resumeAiConversationAction(conversationId: string): Promise<SalesAgentActionResult> {
  const { supabase, user } = await requireCurrentUser();
  try {
    await updateConversationState(
      supabase,
      conversationId,
      { id: user.userId, type: "user" },
      { mode: "ai", handoverReason: `${user.fullName ?? "A staff member"} handed this conversation back to the AI.` }
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to resume the AI." };
  }

  revalidatePath("/ai");
  return {};
}

export async function pauseAiConversationAction(conversationId: string): Promise<SalesAgentActionResult> {
  const { supabase, user } = await requireCurrentUser();
  try {
    await updateConversationState(
      supabase,
      conversationId,
      { id: user.userId, type: "user" },
      { mode: "paused", handoverReason: `${user.fullName ?? "A staff member"} paused the AI on this conversation.` }
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to pause the AI." };
  }

  revalidatePath("/ai");
  return {};
}

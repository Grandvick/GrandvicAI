import "server-only";
import type { AiToolCallRecord } from "../types";
import type { ConversationState } from "@/lib/business/conversations";

/**
 * Owner-visibility rules for the AI Sales Agent (spec section 21 — "Do not
 * spam the owner for every message. Create sensible notification rules.").
 *
 * Pure and deterministic: given what actually happened in one request (the
 * tool calls that ran, and the conversation's state immediately before vs.
 * after), decides which notifications (if any) to raise. The API route
 * calls src/lib/business/notifications.ts's existing createNotification()
 * for each one returned here — this function never touches the database
 * itself, so it's trivially unit-testable (notifications.test.ts).
 *
 * Deliberately conservative and diff-based, mirroring the existing
 * shouldNotifyHotLead() pattern in src/lib/business/hot-lead.ts: a
 * notification only fires on a genuine TRANSITION within this request
 * (e.g. mode going from "ai" to "human"), never on every message while
 * already in that state — that's what keeps this from spamming the owner
 * on a long conversation.
 *
 * Known limitation (documented, not hidden): "customer appears ready to
 * proceed" and fine-grained complaint detection are coarser than a human
 * reviewer would be — Phase 4 only fires on the concrete, structural
 * signals below (hot lead, human handover, paused/complaint intent). Worth
 * revisiting with real usage data in a later phase.
 */

export type OwnerNotificationInstruction = {
  level: "normal" | "important" | "high_priority" | "critical";
  title: string;
  body?: string;
  relatedType: "lead" | "conversation";
  relatedId: string;
};

function findSuccessfulCall(toolCalls: AiToolCallRecord[], name: string) {
  return toolCalls.find((c) => c.name === name && !c.error);
}

export function evaluateOwnerNotifications(params: {
  toolCalls: AiToolCallRecord[];
  before: ConversationState | null;
  after: ConversationState;
  customerName?: string | null;
}): OwnerNotificationInstruction[] {
  const { toolCalls, before, after, customerName } = params;
  const notifications: OwnerNotificationInstruction[] = [];
  const who = customerName || "A customer";

  // 1. HOT lead created or moved to hot by the AI in this request.
  for (const name of ["create_lead", "update_lead"] as const) {
    const call = findSuccessfulCall(toolCalls, name);
    const result = call?.result as { leadId?: string; temperature?: string } | undefined;
    if (result?.temperature === "hot" && result.leadId) {
      notifications.push({
        level: "important",
        title: `🔥 Hot lead from AI Sales Agent: ${who}`,
        body: "The AI Sales Agent qualified this conversation as a hot lead. Recommended action: contact this customer.",
        relatedType: "lead",
        relatedId: result.leadId,
      });
      break; // one hot-lead notification per request is enough even if both tools ran
    }
  }

  // 2. Human assistance requested — mode just transitioned into "human".
  if (after.mode === "human" && before?.mode !== "human") {
    notifications.push({
      level: "high_priority",
      title: `Human assistance requested: ${who}`,
      body: after.handoverReason || "The AI Sales Agent handed this conversation to a human.",
      relatedType: "conversation",
      relatedId: after.id,
    });
  }

  // 3. AI paused itself without a human yet picking it up — still worth a heads-up, one level down.
  if (after.mode === "paused" && before?.mode !== "paused") {
    notifications.push({
      level: "normal",
      title: `AI paused a conversation: ${who}`,
      body: after.handoverReason || "The AI Sales Agent paused itself on this conversation.",
      relatedType: "conversation",
      relatedId: after.id,
    });
  }

  // 4. A complaint was just detected.
  if (after.intent === "COMPLAINT" && before?.intent !== "COMPLAINT") {
    notifications.push({
      level: "high_priority",
      title: `Complaint detected: ${who}`,
      body: "The AI Sales Agent detected a complaint in this conversation.",
      relatedType: "conversation",
      relatedId: after.id,
    });
  }

  return notifications;
}

import { describe, expect, it } from "vitest";
import { evaluateOwnerNotifications } from "./notifications";
import type { ConversationState } from "@/lib/business/conversations";

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    id: "conv-1",
    businessId: "biz-1",
    customerId: "cust-1",
    channel: "website",
    mode: "ai",
    status: "open",
    leadId: null,
    intent: null,
    matchedOpportunityId: null,
    qualification: {},
    handoverReason: null,
    lastMessageAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("evaluateOwnerNotifications (spec section 21)", () => {
  it("notifies on a newly created hot lead", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [{ name: "create_lead", arguments: {}, result: { leadId: "lead-1", temperature: "hot" } }],
      before: state(),
      after: state({ leadId: "lead-1" }),
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].relatedType).toBe("lead");
    expect(notifications[0].relatedId).toBe("lead-1");
  });

  it("does not notify for a warm or nurture lead", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [{ name: "create_lead", arguments: {}, result: { leadId: "lead-1", temperature: "warm" } }],
      before: state(),
      after: state({ leadId: "lead-1" }),
    });
    expect(notifications).toHaveLength(0);
  });

  it("does not notify twice for two hot-lead-producing tool calls in one request", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [
        { name: "create_lead", arguments: {}, result: { leadId: "lead-1", temperature: "hot" } },
        { name: "update_lead", arguments: {}, result: { leadId: "lead-1", temperature: "hot" } },
      ],
      before: state(),
      after: state({ leadId: "lead-1" }),
    });
    expect(notifications).toHaveLength(1);
  });

  it("notifies on a fresh transition into human mode", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [],
      before: state({ mode: "ai" }),
      after: state({ mode: "human", handoverReason: "customer requested a human" }),
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].level).toBe("high_priority");
  });

  it("does not re-notify while already in human mode", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [],
      before: state({ mode: "human" }),
      after: state({ mode: "human" }),
    });
    expect(notifications).toHaveLength(0);
  });

  it("notifies once on a freshly detected complaint", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [],
      before: state({ intent: null }),
      after: state({ intent: "COMPLAINT" }),
    });
    expect(notifications.some((n) => n.title.includes("Complaint"))).toBe(true);
  });

  it("does not re-notify a complaint already recorded on the conversation", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [],
      before: state({ intent: "COMPLAINT" }),
      after: state({ intent: "COMPLAINT" }),
    });
    expect(notifications).toHaveLength(0);
  });

  it("returns nothing at all for a quiet, uneventful message", () => {
    const notifications = evaluateOwnerNotifications({
      toolCalls: [{ name: "search_customers", arguments: {}, result: [] }],
      before: state(),
      after: state(),
    });
    expect(notifications).toHaveLength(0);
  });
});

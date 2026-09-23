import { describe, expect, it } from "vitest";
import { getRegisteredTools, getProviderToolSchemas, getToolDefinition, executeTool } from "./registry";
import { AiToolError, AiValidationError } from "../errors";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { AiToolContext } from "../types";

function fakeCtx(overrides: Partial<AiToolContext> = {}): AiToolContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeFakeSupabase({}) as any,
    userId: "user-1",
    roleKey: "owner",
    isOwner: true,
    businessId: "biz-1",
    businessName: "Grandvic Tours & Travel",
    now: new Date("2026-09-20T00:00:00.000Z"),
    conversationId: null,
    ...overrides,
  };
}

const READ_TOOL_NAMES = [
  "get_dashboard_summary",
  "get_business_summary",
  "search_customers",
  "get_customer",
  "search_leads",
  "get_lead",
  "get_hot_leads",
  "get_open_jobs",
  "get_job",
  "get_job_applicants",
  "get_application",
  "get_missing_documents",
  "get_tasks",
  "get_notifications",
  "get_recent_activity",
  "get_business_settings",
  "search_knowledge_base",
  "find_customer_by_contact",
];

const WRITE_TOOL_NAMES = [
  "create_customer",
  "create_lead",
  "update_lead",
  "create_task",
  "add_conversation_event",
  "update_conversation_state",
];

const EXPECTED_TOOL_NAMES = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES];

/** High-risk actions the spec explicitly forbids in Phase 4 (section 15) — must never appear under any name. */
const FORBIDDEN_TOOL_NAME_PATTERN =
  /sql|query_raw|raw_query|^execute|update_database|delete_|refund|confirm_payment|update_application_status|approve_applicant|reject_applicant|close_job|publish_|send_whatsapp|send_email/i;

describe("AI tool registry — safety and integrity (spec section 4/9/14/15/19)", () => {
  it("registers exactly the expected read + write tools — no hidden extras", () => {
    const names = getRegisteredTools().map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("classifies every read tool as read and every write tool as write", () => {
    for (const tool of getRegisteredTools()) {
      if (READ_TOOL_NAMES.includes(tool.name)) expect(tool.permission).toBe("read");
      if (WRITE_TOOL_NAMES.includes(tool.name)) expect(tool.permission).toBe("write");
    }
  });

  it("never registers a SQL-execution, delete, payment, or status-override capability, however named", () => {
    const suspicious = getRegisteredTools().filter((t) => FORBIDDEN_TOOL_NAME_PATTERN.test(t.name));
    expect(suspicious).toEqual([]);
  });

  it("never lets the model supply a businessId/business_id — scope always comes from the authenticated session", () => {
    for (const tool of getRegisteredTools()) {
      const schema = z_shape(tool);
      expect(schema).not.toContain("businessId");
      expect(schema).not.toContain("business_id");
    }
  });

  it("never lets the model supply a conversationId — scope always comes from the authenticated request, not model input", () => {
    for (const tool of getRegisteredTools()) {
      const schema = z_shape(tool);
      expect(schema).not.toContain("conversationId");
      expect(schema).not.toContain("conversation_id");
    }
  });

  function z_shape(tool: ReturnType<typeof getRegisteredTools>[number]): string {
    return JSON.stringify(getProviderToolSchemas().find((s) => s.name === tool.name)?.parameters ?? {});
  }

  it("converts every tool's input schema into a usable JSON Schema for the provider", () => {
    const schemas = getProviderToolSchemas();
    expect(schemas.length).toBe(EXPECTED_TOOL_NAMES.length);
    for (const s of schemas) {
      expect(s.name).toBeTruthy();
      expect(s.description.length).toBeGreaterThan(5);
      expect(s.parameters).toHaveProperty("type", "object");
    }
  });

  it("getToolDefinition returns undefined for an unregistered name", () => {
    expect(getToolDefinition("delete_customer")).toBeUndefined();
    expect(getToolDefinition("execute_sql")).toBeUndefined();
  });

  it("executeTool rejects an unknown tool name with a safe AiToolError", async () => {
    await expect(executeTool(fakeCtx(), "delete_customer", {})).rejects.toBeInstanceOf(AiToolError);
  });

  it("executeTool rejects malformed/invalid arguments with a safe AiValidationError, not a crash", async () => {
    // get_customer requires a UUID customerId — send garbage.
    await expect(executeTool(fakeCtx(), "get_customer", { customerId: "not-a-uuid" })).rejects.toBeInstanceOf(
      AiValidationError
    );
  });

  it("executeTool rejects arguments of the wrong type entirely", async () => {
    await expect(executeTool(fakeCtx(), "search_leads", { temperature: 12345 })).rejects.toBeInstanceOf(
      AiValidationError
    );
  });

  it("executeTool accepts an empty object for a no-argument tool", async () => {
    const result = await executeTool(fakeCtx({ supabase: makeFakeSupabase({ customers: [], leads: [] }) as never }), "search_customers", {});
    expect(Array.isArray(result)).toBe(true);
  });
});

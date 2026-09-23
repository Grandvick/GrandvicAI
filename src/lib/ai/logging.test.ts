import { describe, expect, it } from "vitest";
import { logAiRun, summarizeToolCalls } from "./logging";
import type { SupabaseClient } from "@supabase/supabase-js";

function captureSupabase() {
  const inserted: unknown[] = [];
  const supabase = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          inserted.push({ table, row });
          return { error: null };
        },
      };
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, inserted };
}

describe("logAiRun — ai_runs logging (spec section 10)", () => {
  it("writes one row to ai_runs with the expected shape, and a cost estimate for a known model", async () => {
    const { supabase, inserted } = captureSupabase();

    await logAiRun(supabase, {
      businessId: "biz-1",
      userId: "user-1",
      runType: "command_centre",
      input: { message: "Show me open jobs", historyLength: 0 },
      output: { reply: "There are 2 open jobs.", toolCalls: [{ name: "get_open_jobs", ok: true }] },
      model: "gpt-4o-mini",
      tokensInput: 500,
      tokensOutput: 120,
      latencyMs: 842,
      status: "success",
    });

    expect(inserted).toHaveLength(1);
    const { table, row } = inserted[0] as { table: string; row: Record<string, unknown> };
    expect(table).toBe("ai_runs");
    expect(row.business_id).toBe("biz-1");
    expect(row.user_id).toBe("user-1");
    expect(row.run_type).toBe("command_centre");
    expect(row.model).toBe("gpt-4o-mini");
    expect(row.status).toBe("success");
    expect(row.tokens_input).toBe(500);
    expect(row.tokens_output).toBe(120);
    expect(row.latency_ms).toBe(842);
    expect(typeof row.cost_estimate).toBe("number");
    expect(row.cost_estimate as number).toBeGreaterThan(0);
    // Never stores raw secrets/tokens — just the message shape and a tool-call summary.
    expect(row.input).toEqual({ message: "Show me open jobs", historyLength: 0 });
  });

  it("never throws when the insert fails — logging must not break the chat response", async () => {
    const supabase = {
      from() {
        return {
          insert: async () => {
            throw new Error("connection reset");
          },
        };
      },
    } as unknown as SupabaseClient;

    await expect(
      logAiRun(supabase, {
        businessId: "biz-1",
        userId: "user-1",
        runType: "command_centre",
        input: { message: "hi", historyLength: 0 },
        output: { reply: "", toolCalls: [] },
        model: null,
        tokensInput: null,
        tokensOutput: null,
        latencyMs: 10,
        status: "error",
        errorMessage: "something failed",
      })
    ).resolves.toBeUndefined();
  });

  it("returns null cost_estimate for an unrecognized model rather than inventing a number", async () => {
    const { supabase, inserted } = captureSupabase();
    await logAiRun(supabase, {
      businessId: "biz-1",
      userId: "user-1",
      runType: "command_centre",
      input: { message: "hi", historyLength: 0 },
      output: { reply: "hello", toolCalls: [] },
      model: "some-future-model",
      tokensInput: 100,
      tokensOutput: 50,
      latencyMs: 10,
      status: "success",
    });
    const row = (inserted[0] as { row: Record<string, unknown> }).row;
    expect(row.cost_estimate).toBeNull();
  });
});

describe("summarizeToolCalls", () => {
  it("reduces full tool-call records to name + success flag only", () => {
    const summary = summarizeToolCalls([
      { name: "get_open_jobs", arguments: {}, result: [{ id: "job-1" }] },
      { name: "get_customer", arguments: { customerId: "x" }, error: "No customer found with that id." },
    ]);
    expect(summary).toEqual([
      { name: "get_open_jobs", ok: true },
      { name: "get_customer", ok: false },
    ]);
  });
});


import { describe, expect, it, vi } from "vitest";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const hoisted = vi.hoisted(() => ({
  supabase: null as unknown as SupabaseClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(async () => hoisted.supabase),
}));

// resolveAiRequestContext/toToolContext (also exported from this module)
// depend on next/headers' cookies() and Supabase session helpers that only
// work inside a request — irrelevant to toSystemToolContext, which this
// file tests in isolation, so nothing else in @/lib/business/context or
// @/lib/business/businesses needs mocking here.

describe("toSystemToolContext (Phase 5C — the non-session counterpart to resolveAiRequestContext/toToolContext)", () => {
  it("builds an AiToolContext with a null userId, role 'system', and isOwner false — never a signed-in staff identity", async () => {
    hoisted.supabase = makeFakeSupabase({
      businesses: [{ id: "biz-1", name: "Grandvic Tours & Travel" }],
    }) as unknown as SupabaseClient;

    const { toSystemToolContext } = await import("./context");
    const ctx = await toSystemToolContext("biz-1", "conv-1");

    expect(ctx.userId).toBeNull();
    expect(ctx.roleKey).toBe("system");
    expect(ctx.isOwner).toBe(false);
    expect(ctx.businessId).toBe("biz-1");
    expect(ctx.businessName).toBe("Grandvic Tours & Travel");
    expect(ctx.conversationId).toBe("conv-1");
  });

  it("passes conversationId through as null when none is given yet (mirrors toToolContext's default)", async () => {
    hoisted.supabase = makeFakeSupabase({
      businesses: [{ id: "biz-1", name: "Grandvic Tours & Travel" }],
    }) as unknown as SupabaseClient;

    const { toSystemToolContext } = await import("./context");
    const ctx = await toSystemToolContext("biz-1", null);

    expect(ctx.conversationId).toBeNull();
  });

  it("throws AiBusinessContextError when businessId doesn't resolve to a real business — a webhook's phone_number_id mapping problem, not a silent no-op", async () => {
    hoisted.supabase = makeFakeSupabase({ businesses: [] }) as unknown as SupabaseClient;

    const { toSystemToolContext } = await import("./context");
    const { AiBusinessContextError } = await import("./errors");

    await expect(toSystemToolContext("nonexistent-biz", null)).rejects.toBeInstanceOf(AiBusinessContextError);
  });

  it("uses the service-role client, never the RLS-scoped session client (there is no session to scope from)", async () => {
    const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
    hoisted.supabase = makeFakeSupabase({
      businesses: [{ id: "biz-1", name: "Grandvic Tours & Travel" }],
    }) as unknown as SupabaseClient;

    const { toSystemToolContext } = await import("./context");
    await toSystemToolContext("biz-1", null);

    expect(createSupabaseServiceRoleClient).toHaveBeenCalled();
  });
});

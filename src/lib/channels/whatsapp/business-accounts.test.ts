import { describe, expect, it } from "vitest";
import { resolveWhatsAppBusinessId } from "./business-accounts";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    business_id: "biz-1",
    phone_number_id: "phone-1",
    waba_id: "waba-1",
    display_phone_number: "254700000000",
    is_active: true,
    ...overrides,
  };
}

describe("resolveWhatsAppBusinessId (Phase 5F — the ONLY source of truth for a webhook's business_id)", () => {
  it("resolves the business_id for a known, active phone_number_id", async () => {
    const supabase = makeFakeSupabase({ whatsapp_business_accounts: [accountRow()] }) as unknown as SupabaseClient;
    expect(await resolveWhatsAppBusinessId(supabase, "phone-1")).toBe("biz-1");
  });

  it("returns null for a phone_number_id with no mapped account at all", async () => {
    const supabase = makeFakeSupabase({ whatsapp_business_accounts: [accountRow()] }) as unknown as SupabaseClient;
    expect(await resolveWhatsAppBusinessId(supabase, "phone-unknown")).toBeNull();
  });

  it("returns null for a mapped but INACTIVE account — never routes to a deactivated number", async () => {
    const supabase = makeFakeSupabase({
      whatsapp_business_accounts: [accountRow({ is_active: false })],
    }) as unknown as SupabaseClient;
    expect(await resolveWhatsAppBusinessId(supabase, "phone-1")).toBeNull();
  });

  it("never resolves a different business's phone_number_id to the wrong business_id (business isolation)", async () => {
    const supabase = makeFakeSupabase({
      whatsapp_business_accounts: [
        accountRow({ id: "acct-1", business_id: "biz-1", phone_number_id: "phone-1" }),
        accountRow({ id: "acct-2", business_id: "biz-2", phone_number_id: "phone-2" }),
      ],
    }) as unknown as SupabaseClient;

    expect(await resolveWhatsAppBusinessId(supabase, "phone-1")).toBe("biz-1");
    expect(await resolveWhatsAppBusinessId(supabase, "phone-2")).toBe("biz-2");
  });
});

import { describe, expect, it } from "vitest";
import { recordWebhookEventOnce } from "./webhook-events";
import { makeFakeSupabase } from "@/test/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("recordWebhookEventOnce (Phase 5F — Layer 1 idempotency, the first DB write for any inbound message)", () => {
  it("returns true and inserts a row for a new wa_event_id", async () => {
    const supabase = makeFakeSupabase({ whatsapp_webhook_events: [] }) as unknown as SupabaseClient;

    const result = await recordWebhookEventOnce(supabase, "wamid.NEW", { hello: "world" });

    expect(result).toBe(true);
    const { data } = await supabase.from("whatsapp_webhook_events").select("*");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ wa_event_id: "wamid.NEW", payload: { hello: "world" } });
  });

  it("returns false (not an error) when the event was already recorded — a unique-violation (23505) on insert", async () => {
    let insertCalls = 0;
    const fakeClient = {
      from(table: string) {
        expect(table).toBe("whatsapp_webhook_events");
        return {
          insert() {
            insertCalls += 1;
            return this;
          },
          select() {
            return this;
          },
          async then(resolve: (v: { error: unknown }) => unknown) {
            return resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as SupabaseClient;

    const result = await recordWebhookEventOnce(fakeClient, "wamid.DUP", { hello: "world" });

    expect(result).toBe(false);
    expect(insertCalls).toBe(1);
  });

  it("re-throws a genuine (non-23505) database error rather than swallowing it as 'already processed'", async () => {
    const fakeClient = {
      from() {
        return {
          insert() {
            return this;
          },
          async then(resolve: (v: { error: unknown }) => unknown) {
            return resolve({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as SupabaseClient;

    await expect(recordWebhookEventOnce(fakeClient, "wamid.X", {})).rejects.toMatchObject({ code: "57014" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const hoisted = vi.hoisted(() => ({
  appSecret: "test-app-secret" as string | null,
  verifyToken: "test-verify-token" as string | null,
}));

vi.mock("@/lib/config", () => ({
  whatsAppWebhookConfig: {
    get appSecret() {
      return hoisted.appSecret;
    },
    get verifyToken() {
      return hoisted.verifyToken;
    },
  },
}));

const recordWebhookEventOnce = vi.fn();
vi.mock("@/lib/channels/whatsapp/webhook-events", () => ({
  recordWebhookEventOnce: (...args: unknown[]) => recordWebhookEventOnce(...args),
}));

const resolveWhatsAppBusinessId = vi.fn();
vi.mock("@/lib/channels/whatsapp/business-accounts", () => ({
  resolveWhatsAppBusinessId: (...args: unknown[]) => resolveWhatsAppBusinessId(...args),
}));

const conversationMessageExternalIdExists = vi.fn();
vi.mock("@/lib/business/conversations", () => ({
  conversationMessageExternalIdExists: (...args: unknown[]) => conversationMessageExternalIdExists(...args),
}));

const orchestrateInboundWhatsAppMessage = vi.fn();
vi.mock("@/lib/channels/whatsapp/orchestrate", () => ({
  orchestrateInboundWhatsAppMessage: (...args: unknown[]) => orchestrateInboundWhatsAppMessage(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(async () => ({ marker: "service-role-client" })),
}));

function textEnvelope(message: { id: string; from?: string; text?: string; phoneNumberId?: string } = { id: "wamid.1" }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: message.phoneNumberId ?? "phone-1" },
              messages: [
                {
                  from: message.from ?? "254799999911",
                  id: message.id,
                  type: "text",
                  text: { body: message.text ?? "hello" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function signedRequest(body: unknown, opts: { badSignature?: boolean; noSignature?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.noSignature) {
    const sig = opts.badSignature
      ? "sha256=" + "0".repeat(64)
      : `sha256=${createHmac("sha256", hoisted.appSecret ?? "").update(raw, "utf8").digest("hex")}`;
    headers["x-hub-signature-256"] = sig;
  }
  return new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers, body: raw });
}

describe("GET /api/webhooks/whatsapp (Phase 5F — Meta's one-time verification handshake)", () => {
  beforeEach(() => {
    hoisted.appSecret = "test-app-secret";
    hoisted.verifyToken = "test-verify-token";
  });

  it("echoes hub.challenge back verbatim when hub.mode=subscribe and the token matches", async () => {
    const { GET } = await import("./route");
    const req = new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=1158201444"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("returns 403 when the verify token doesn't match", async () => {
    const { GET } = await import("./route");
    const req = new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1158201444"
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when hub.mode isn't 'subscribe'", async () => {
    const { GET } = await import("./route");
    const req = new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=test-verify-token&hub.challenge=123"
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 503 without leaking internals when WHATSAPP_WEBHOOK_VERIFY_TOKEN isn't configured", async () => {
    hoisted.verifyToken = null;
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1");
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

describe("POST /api/webhooks/whatsapp (Phase 5F — the real inbound webhook)", () => {
  beforeEach(() => {
    hoisted.appSecret = "test-app-secret";
    hoisted.verifyToken = "test-verify-token";
    recordWebhookEventOnce.mockReset();
    recordWebhookEventOnce.mockResolvedValue(true);
    resolveWhatsAppBusinessId.mockReset();
    resolveWhatsAppBusinessId.mockResolvedValue("biz-1");
    conversationMessageExternalIdExists.mockReset();
    conversationMessageExternalIdExists.mockResolvedValue(false);
    orchestrateInboundWhatsAppMessage.mockReset();
    orchestrateInboundWhatsAppMessage.mockResolvedValue({ ok: true, aiResponded: true, conversationId: "conv-1" });
  });

  it("rejects a request with an invalid signature with 401, before touching any of the dedup/business/orchestration layers", async () => {
    const { POST } = await import("./route");
    const res = await POST(signedRequest(textEnvelope(), { badSignature: true }));

    expect(res.status).toBe(401);
    expect(recordWebhookEventOnce).not.toHaveBeenCalled();
    expect(orchestrateInboundWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header at all", async () => {
    const { POST } = await import("./route");
    const res = await POST(signedRequest(textEnvelope(), { noSignature: true }));
    expect(res.status).toBe(401);
  });

  it("returns 503 without processing anything when WHATSAPP_APP_SECRET isn't configured", async () => {
    hoisted.appSecret = null;
    const { POST } = await import("./route");
    const res = await POST(signedRequest(textEnvelope(), { noSignature: true }));
    expect(res.status).toBe(503);
    expect(orchestrateInboundWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload with 413 before parsing or verifying", async () => {
    const { POST } = await import("./route");
    const huge = "x".repeat(1_000_001);
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=irrelevant" },
      body: huge,
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("returns 400 when the signature is valid but the body isn't valid JSON", async () => {
    const raw = "not json at all";
    const sig = `sha256=${createHmac("sha256", "test-app-secret").update(raw, "utf8").digest("hex")}`;
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": sig },
      body: raw,
    });
    const { POST } = await import("./route");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 with no side effects for a payload with no extractable text messages (e.g. a statuses update)", async () => {
    const statusesPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-1" }, statuses: [{ id: "wamid.1", status: "delivered" }] } }] }],
    };
    const { POST } = await import("./route");
    const res = await POST(signedRequest(statusesPayload));
    expect(res.status).toBe(200);
    expect(recordWebhookEventOnce).not.toHaveBeenCalled();
  });

  it("happy path: valid signature -> records the event -> resolves the business -> checks Layer 2 -> orchestrates -> 200", async () => {
    const { POST } = await import("./route");
    const res = await POST(signedRequest(textEnvelope({ id: "wamid.HAPPY", from: "254799999911", text: "Hi!" })));

    expect(res.status).toBe(200);
    expect(recordWebhookEventOnce).toHaveBeenCalledWith(expect.anything(), "wamid.HAPPY", expect.anything());
    expect(resolveWhatsAppBusinessId).toHaveBeenCalledWith(expect.anything(), "phone-1");
    expect(conversationMessageExternalIdExists).toHaveBeenCalledWith(expect.anything(), "wamid.HAPPY");
    expect(orchestrateInboundWhatsAppMessage).toHaveBeenCalledWith({
      businessId: "biz-1",
      fromPhone: "254799999911",
      text: "Hi!",
      externalId: "wamid.HAPPY",
    });
  });

  it("Layer 1: skips business resolution and orchestration entirely when the event was already recorded (a Meta redelivery)", async () => {
    recordWebhookEventOnce.mockResolvedValue(false);
    const { POST } = await import("./route");

    const res = await POST(signedRequest(textEnvelope({ id: "wamid.DUP" })));

    expect(res.status).toBe(200);
    expect(resolveWhatsAppBusinessId).not.toHaveBeenCalled();
    expect(orchestrateInboundWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("drops the message (still 200) when the phone_number_id has no mapped active business", async () => {
    resolveWhatsAppBusinessId.mockResolvedValue(null);
    const { POST } = await import("./route");

    const res = await POST(signedRequest(textEnvelope({ id: "wamid.UNMAPPED" })));

    expect(res.status).toBe(200);
    expect(orchestrateInboundWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("Layer 2: skips orchestration when the message's external_id was already persisted, even though Layer 1 said it was new", async () => {
    conversationMessageExternalIdExists.mockResolvedValue(true);
    const { POST } = await import("./route");

    const res = await POST(signedRequest(textEnvelope({ id: "wamid.ALREADY-PERSISTED" })));

    expect(res.status).toBe(200);
    expect(orchestrateInboundWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("still returns 200 to Meta when orchestration itself fails (failure isolation — never causes a pointless retry)", async () => {
    orchestrateInboundWhatsAppMessage.mockResolvedValue({ ok: false, error: "boom", conversationId: null });
    const { POST } = await import("./route");

    const res = await POST(signedRequest(textEnvelope({ id: "wamid.FAILS" })));

    expect(res.status).toBe(200);
  });

  it("still returns 200 when an unexpected exception is thrown mid-processing (e.g. a database error) — never an uncaught 500", async () => {
    resolveWhatsAppBusinessId.mockRejectedValue(new Error("connection reset"));
    const { POST } = await import("./route");

    const res = await POST(signedRequest(textEnvelope({ id: "wamid.THROWS" })));

    expect(res.status).toBe(200);
  });

  it("processes every message in a multi-message batch independently — one failing doesn't stop the others", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "phone-1" },
                messages: [
                  { from: "111", id: "wamid.FIRST", type: "text", text: { body: "first" } },
                  { from: "222", id: "wamid.SECOND", type: "text", text: { body: "second" } },
                ],
              },
            },
          ],
        },
      ],
    };
    resolveWhatsAppBusinessId.mockImplementation(async () => {
      throw new Error("only the first message's business lookup fails, simulated via call count below");
    });
    // Make only the first call throw, second succeeds.
    let call = 0;
    resolveWhatsAppBusinessId.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("transient failure");
      return "biz-1";
    });

    const { POST } = await import("./route");
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(resolveWhatsAppBusinessId).toHaveBeenCalledTimes(2);
    expect(orchestrateInboundWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(orchestrateInboundWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "wamid.SECOND" })
    );
  });
});

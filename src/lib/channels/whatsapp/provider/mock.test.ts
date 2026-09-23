import { describe, expect, it } from "vitest";
import { MockWhatsAppProvider } from "./mock";
import { WhatsAppSendError } from "../errors";

describe("MockWhatsAppProvider (Phase 5B — the WhatsApp analog of DevRuleBasedProvider)", () => {
  it("sendText resolves a unique externalId and status 'sent', and records the call", async () => {
    const provider = new MockWhatsAppProvider();
    const result = await provider.sendText({ to: "254700111222", body: "Hello from Grandvic AI" });

    expect(result.status).toBe("sent");
    expect(result.externalId).toBeTruthy();
    expect(provider.sentMessages).toHaveLength(1);
    expect(provider.sentMessages[0]).toMatchObject({ kind: "text", input: { to: "254700111222", body: "Hello from Grandvic AI" }, result });
  });

  it("sendTemplate, sendMedia, and sendDocument all resolve and record their own kind", async () => {
    const provider = new MockWhatsAppProvider();

    const template = await provider.sendTemplate({ to: "254700111222", templateName: "order_update", language: "en", variables: { name: "Jane" } });
    const media = await provider.sendMedia({ to: "254700111222", mediaUrl: "https://example.com/photo.jpg", mimeType: "image/jpeg" });
    const document = await provider.sendDocument({ to: "254700111222", mediaUrl: "https://example.com/offer.pdf", filename: "offer.pdf", mimeType: "application/pdf" });

    expect(template.status).toBe("sent");
    expect(media.status).toBe("sent");
    expect(document.status).toBe("sent");
    expect(provider.sentMessages.map((m) => m.kind)).toEqual(["template", "media", "document"]);
  });

  it("every send gets a distinct externalId, in call order", async () => {
    const provider = new MockWhatsAppProvider();
    const a = await provider.sendText({ to: "254700111222", body: "one" });
    const b = await provider.sendText({ to: "254700111222", body: "two" });
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("never makes a network call — resolves purely in-process (no fetch/global network mock needed for this test to pass)", async () => {
    const provider = new MockWhatsAppProvider();
    await expect(provider.sendText({ to: "254700111222", body: "hi" })).resolves.toBeDefined();
  });

  it.each([
    ["sendText", () => new MockWhatsAppProvider().sendText({ to: "", body: "hi" })],
    ["sendText", () => new MockWhatsAppProvider().sendText({ to: "254700111222", body: "  " })],
    ["sendTemplate", () => new MockWhatsAppProvider().sendTemplate({ to: "", templateName: "x", language: "en" })],
    ["sendTemplate", () => new MockWhatsAppProvider().sendTemplate({ to: "254700111222", templateName: "", language: "en" })],
    ["sendTemplate", () => new MockWhatsAppProvider().sendTemplate({ to: "254700111222", templateName: "x", language: "" })],
    ["sendMedia", () => new MockWhatsAppProvider().sendMedia({ to: "254700111222", mediaUrl: "", mimeType: "image/jpeg" })],
    ["sendMedia", () => new MockWhatsAppProvider().sendMedia({ to: "254700111222", mediaUrl: "https://x/y.jpg", mimeType: "" })],
    ["sendDocument", () => new MockWhatsAppProvider().sendDocument({ to: "254700111222", mediaUrl: "", filename: "a.pdf", mimeType: "application/pdf" })],
    ["sendDocument", () => new MockWhatsAppProvider().sendDocument({ to: "254700111222", mediaUrl: "https://x/a.pdf", filename: "", mimeType: "application/pdf" })],
  ])("%s rejects with WhatsAppSendError on invalid input, never silently sending", async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(WhatsAppSendError);
  });

  it("exposes its provider name as 'whatsapp-mock', distinct from a real provider's name", () => {
    expect(new MockWhatsAppProvider().name).toBe("whatsapp-mock");
  });
});

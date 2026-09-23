import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaWhatsAppProvider } from "./meta";
import { WhatsAppSendError } from "../errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function successBody(id = "wamid.HBgL123") {
  return { messaging_product: "whatsapp", contacts: [{ input: "254799999911", wa_id: "254799999911" }], messages: [{ id }] };
}

describe("MetaWhatsAppProvider (Phase 5G — the real Graph API-backed outbound provider)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function provider() {
    return new MetaWhatsAppProvider("test-access-token", "phone-1", "v21.0");
  }

  describe("sendText", () => {
    it("POSTs to the correct Graph API URL with the bearer token and a text body, returning the message id", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody("wamid.TEXT1")));

      const result = await provider().sendText({ to: "254799999911", body: "Hello there" });

      expect(result).toEqual({ externalId: "wamid.TEXT1", status: "sent" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://graph.facebook.com/v21.0/phone-1/messages");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer test-access-token");
      const body = JSON.parse(init.body);
      expect(body).toEqual({ messaging_product: "whatsapp", to: "254799999911", type: "text", text: { body: "Hello there" } });
    });

    it("rejects an empty body before making any network call", async () => {
      await expect(provider().sendText({ to: "254799999911", body: "   " })).rejects.toThrow(WhatsAppSendError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an empty 'to' before making any network call", async () => {
      await expect(provider().sendText({ to: "", body: "hi" })).rejects.toThrow(WhatsAppSendError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("sendTemplate", () => {
    it("sends a template with language code and no components when there are no variables", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody()));
      await provider().sendTemplate({ to: "254799999911", templateName: "welcome", language: "en_US" });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("template");
      expect(body.template).toEqual({ name: "welcome", language: { code: "en_US" } });
    });

    it("includes body-component parameters when variables are given", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody()));
      await provider().sendTemplate({
        to: "254799999911",
        templateName: "job_match",
        language: "en_US",
        variables: { name: "Jane", job: "Nurse" },
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.template.components).toEqual([
        { type: "body", parameters: [{ type: "text", text: "Jane" }, { type: "text", text: "Nurse" }] },
      ]);
    });

    it("rejects an empty templateName or language before any network call", async () => {
      await expect(provider().sendTemplate({ to: "1", templateName: "", language: "en" })).rejects.toThrow(WhatsAppSendError);
      await expect(provider().sendTemplate({ to: "1", templateName: "x", language: "" })).rejects.toThrow(WhatsAppSendError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("sendMedia", () => {
    it("sends an image/* mimeType as Graph type 'image' with a link", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody()));
      await provider().sendMedia({ to: "254799999911", mediaUrl: "https://storage.example/img.jpg", mimeType: "image/jpeg", caption: "Passport photo" });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("image");
      expect(body.image).toEqual({ link: "https://storage.example/img.jpg", caption: "Passport photo" });
    });

    it("sends a video/* mimeType as Graph type 'video'", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody()));
      await provider().sendMedia({ to: "254799999911", mediaUrl: "https://storage.example/v.mp4", mimeType: "video/mp4" });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("video");
      expect(body.video).toEqual({ link: "https://storage.example/v.mp4" });
    });

    it("sends an audio/* mimeType as Graph type 'audio'", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody()));
      await provider().sendMedia({ to: "254799999911", mediaUrl: "https://storage.example/a.ogg", mimeType: "audio/ogg" });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("audio");
    });

    it("rejects an unsupported mimeType (e.g. application/pdf) rather than guessing, pointing at sendDocument", async () => {
      await expect(
        provider().sendMedia({ to: "254799999911", mediaUrl: "https://storage.example/f.pdf", mimeType: "application/pdf" })
      ).rejects.toThrow(/sendDocument/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("sendDocument", () => {
    it("sends a document with link and filename", async () => {
      fetchMock.mockResolvedValue(jsonResponse(successBody()));
      await provider().sendDocument({ to: "254799999911", mediaUrl: "https://storage.example/offer.pdf", filename: "offer.pdf", mimeType: "application/pdf" });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.type).toBe("document");
      expect(body.document).toEqual({ link: "https://storage.example/offer.pdf", filename: "offer.pdf" });
    });

    it("rejects an empty filename before any network call", async () => {
      await expect(
        provider().sendDocument({ to: "1", mediaUrl: "https://x/y.pdf", filename: "", mimeType: "application/pdf" })
      ).rejects.toThrow(WhatsAppSendError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("error handling — every failure surfaces as a clean WhatsAppSendError, never a raw exception", () => {
    it("wraps a network-level failure (fetch itself throws)", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      await expect(provider().sendText({ to: "1", body: "hi" })).rejects.toThrow(WhatsAppSendError);
    });

    it("surfaces Meta's own error message on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { message: "Invalid parameter", type: "OAuthException", code: 100 } }, 400)
      );
      await expect(provider().sendText({ to: "1", body: "hi" })).rejects.toThrow(/Invalid parameter/);
    });

    it("falls back to the HTTP status when Meta's error body has no message", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 500));
      await expect(provider().sendText({ to: "1", body: "hi" })).rejects.toThrow(/HTTP 500/);
    });

    it("throws when the response body isn't valid JSON at all", async () => {
      fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
      await expect(provider().sendText({ to: "1", body: "hi" })).rejects.toThrow(WhatsAppSendError);
    });

    it("throws when a 2xx response has no usable message id", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ messaging_product: "whatsapp", contacts: [], messages: [] }));
      await expect(provider().sendText({ to: "1", body: "hi" })).rejects.toThrow(/no message id/);
    });
  });
});

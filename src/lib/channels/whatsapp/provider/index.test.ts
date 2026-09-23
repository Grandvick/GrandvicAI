import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppConfigError as WhatsAppConfigErrorType } from "../errors";

const ENV_KEYS = ["WHATSAPP_PROVIDER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_VERSION"] as const;

describe("getWhatsAppProvider — provider factory (Phase 5B mock / Phase 5G real, WHATSAPP_PROVIDER switch)", () => {
  const original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    vi.resetModules();
  });

  it("returns MockWhatsAppProvider when WHATSAPP_PROVIDER=mock", async () => {
    process.env.WHATSAPP_PROVIDER = "mock";
    vi.resetModules();
    const { getWhatsAppProvider } = await import("./index");

    const provider = getWhatsAppProvider();
    expect(provider.name).toBe("whatsapp-mock");
  });

  it("the mock provider it returns never touches the network — chat-free, resolves purely from its own in-memory state", async () => {
    process.env.WHATSAPP_PROVIDER = "mock";
    vi.resetModules();
    const { getWhatsAppProvider } = await import("./index");

    const provider = getWhatsAppProvider();
    const result = await provider.sendText({ to: "254700111222", body: "hello" });
    expect(result.status).toBe("sent");
  });

  it("throws a safe WhatsAppConfigError when WHATSAPP_PROVIDER is unset and no Meta credentials are configured either", async () => {
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_VERSION;
    vi.resetModules();
    const { WhatsAppConfigError } = await import("../errors");
    const { getWhatsAppProvider } = await import("./index");

    expect(() => getWhatsAppProvider()).toThrow(WhatsAppConfigError);
    try {
      getWhatsAppProvider();
    } catch (err) {
      expect((err as WhatsAppConfigErrorType).statusCode).toBe(503);
      expect((err as WhatsAppConfigErrorType).userMessage).toMatch(/WHATSAPP_ACCESS_TOKEN/);
    }
  });

  it("names every missing variable, not just the first one found", async () => {
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_VERSION;
    vi.resetModules();
    const { getWhatsAppProvider } = await import("./index");

    try {
      getWhatsAppProvider();
      throw new Error("expected getWhatsAppProvider to throw");
    } catch (err) {
      const message = (err as { userMessage: string }).userMessage;
      expect(message).toMatch(/WHATSAPP_ACCESS_TOKEN/);
      expect(message).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
      expect(message).toMatch(/WHATSAPP_API_VERSION/);
    }
  });

  it("throws WhatsAppConfigError when only SOME of the three required Meta variables are set", async () => {
    delete process.env.WHATSAPP_PROVIDER;
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_API_VERSION = "v21.0";
    vi.resetModules();
    const { WhatsAppConfigError } = await import("../errors");
    const { getWhatsAppProvider } = await import("./index");

    expect(() => getWhatsAppProvider()).toThrow(WhatsAppConfigError);
  });

  it("returns MetaWhatsAppProvider once all three required variables are set — WHATSAPP_PROVIDER unset defaults to real, same rule AI_PROVIDER already uses", async () => {
    delete process.env.WHATSAPP_PROVIDER;
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-1";
    process.env.WHATSAPP_API_VERSION = "v21.0";
    vi.resetModules();
    const { getWhatsAppProvider } = await import("./index");

    const provider = getWhatsAppProvider();
    expect(provider.name).toBe("whatsapp-meta");
  });

  it("returns MetaWhatsAppProvider for an explicit non-mock value too (e.g. WHATSAPP_PROVIDER=meta)", async () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-1";
    process.env.WHATSAPP_API_VERSION = "v21.0";
    vi.resetModules();
    const { getWhatsAppProvider } = await import("./index");

    expect(getWhatsAppProvider().name).toBe("whatsapp-meta");
  });
});

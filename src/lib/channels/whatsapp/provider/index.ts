import "server-only";
import { WhatsAppConfigError } from "../errors";
import { MockWhatsAppProvider } from "./mock";
import { MetaWhatsAppProvider } from "./meta";
import { whatsAppProviderConfig, whatsAppApiConfig } from "@/lib/config";
import type { WhatsAppProvider } from "../types";

/**
 * Phase 5B/5G — the WhatsApp provider factory, deliberately mirroring
 * src/lib/ai/provider/index.ts's `getAiProvider()`: one explicit switch
 * (`WHATSAPP_PROVIDER`, see src/lib/config.ts), never an automatic
 * fallback. `WHATSAPP_PROVIDER=mock` returns `MockWhatsAppProvider` for
 * local development/testing; anything else returns the real, Graph
 * API-backed `MetaWhatsAppProvider` (Phase 5G) — but ONLY once
 * `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_API_VERSION`
 * are all actually set. Missing any of them throws a clear
 * `WhatsAppConfigError` naming exactly what's missing, rather than either
 * (a) silently returning the mock — which would risk a later stage
 * mistaking mocked sends for real delivery in what's meant to be a live
 * environment, the same risk `getAiProvider()` avoids for `AI_PROVIDER` —
 * or (b) constructing `MetaWhatsAppProvider` with an undefined token/number/
 * version and letting it fail confusingly on its first real network call.
 */
export function getWhatsAppProvider(): WhatsAppProvider {
  if (whatsAppProviderConfig.kind === "mock") {
    return new MockWhatsAppProvider();
  }

  const { accessToken, phoneNumberId, apiVersion } = whatsAppApiConfig;
  const missing = [
    !accessToken && "WHATSAPP_ACCESS_TOKEN",
    !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
    !apiVersion && "WHATSAPP_API_VERSION",
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0 || !accessToken || !phoneNumberId || !apiVersion) {
    throw new WhatsAppConfigError(
      `Real WhatsApp sending isn't configured yet — missing ${missing.join(", ")}. Set WHATSAPP_PROVIDER=mock for local development, or set these for production — see SETUP.md.`
    );
  }

  return new MetaWhatsAppProvider(accessToken, phoneNumberId, apiVersion);
}

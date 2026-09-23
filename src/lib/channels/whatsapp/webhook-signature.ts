import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Phase 5F — verifies Meta's `X-Hub-Signature-256` header on an inbound
 * webhook POST (Phase 5 plan, section F/I). This is the REAL per-request
 * authentication for every inbound webhook call — distinct from
 * `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, which only proves endpoint ownership
 * once, at subscription time, via the GET handshake (see route.ts's GET
 * handler). An invalid signature must be rejected (401) before the payload
 * is parsed or any database is touched.
 *
 * Takes the RAW request body string, not a parsed object — HMAC is
 * computed over exact bytes, so the caller must read the body with
 * `request.text()` and verify BEFORE calling `JSON.parse()` on it (see
 * route.ts). Uses Node's built-in `crypto` (no new dependency), and a
 * constant-time comparison (`timingSafeEqual`) so this check itself can't
 * leak timing information about the expected signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false;

  // Meta sends "sha256=<hex digest>".
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const providedHex = signatureHeader.slice(prefix.length);

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  // timingSafeEqual throws on a length mismatch rather than returning
  // false — a malformed/truncated header must fail closed, not crash the
  // request handler.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

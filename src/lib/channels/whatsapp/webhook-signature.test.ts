import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "./webhook-signature";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyWebhookSignature (Phase 5F — the real per-request webhook authentication)", () => {
  it("accepts a correctly computed signature", () => {
    const body = JSON.stringify({ hello: "world" });
    const secret = "test-app-secret";
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifyWebhookSignature(body, sign(body, "wrong-secret"), "test-app-secret")).toBe(false);
  });

  it("rejects when the body has been tampered with after signing", () => {
    const originalBody = JSON.stringify({ amount: 1 });
    const secret = "test-app-secret";
    const signature = sign(originalBody, secret);
    const tamperedBody = JSON.stringify({ amount: 1000 });
    expect(verifyWebhookSignature(tamperedBody, signature, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature("{}", null, "test-app-secret")).toBe(false);
  });

  it("rejects an empty app secret rather than comparing against it", () => {
    const body = "{}";
    expect(verifyWebhookSignature(body, sign(body, ""), "")).toBe(false);
  });

  it("rejects a header missing the 'sha256=' prefix", () => {
    const body = JSON.stringify({ a: 1 });
    const secret = "test-app-secret";
    const rawHex = sign(body, secret).slice("sha256=".length);
    expect(verifyWebhookSignature(body, rawHex, secret)).toBe(false);
  });

  it("never throws on a malformed/truncated hex signature (length mismatch must fail closed, not crash)", () => {
    expect(() => verifyWebhookSignature("{}", "sha256=deadbeef", "test-app-secret")).not.toThrow();
    expect(verifyWebhookSignature("{}", "sha256=deadbeef", "test-app-secret")).toBe(false);
  });

  it("never throws on a non-hex signature value", () => {
    expect(() => verifyWebhookSignature("{}", "sha256=not-hex-at-all!!", "test-app-secret")).not.toThrow();
    expect(verifyWebhookSignature("{}", "sha256=not-hex-at-all!!", "test-app-secret")).toBe(false);
  });
});

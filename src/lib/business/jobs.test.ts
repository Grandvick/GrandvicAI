import { describe, expect, it } from "vitest";
import {
  isJobExpired,
  computeEffectiveJobStatus,
  isJobOpenForPromotion,
  isJobExpiringSoon,
  isValidJobStatusTransition,
} from "./jobs";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-15T00:00:00.000Z");

describe("isJobExpired", () => {
  it("is false when there is no expiry date", () => {
    expect(isJobExpired({ expiryAt: null }, NOW)).toBe(false);
  });

  it("is true once expiry_at is in the past", () => {
    expect(isJobExpired({ expiryAt: new Date(NOW.getTime() - DAY_MS).toISOString() }, NOW)).toBe(true);
  });

  it("is false while expiry_at is still in the future", () => {
    expect(isJobExpired({ expiryAt: new Date(NOW.getTime() + DAY_MS).toISOString() }, NOW)).toBe(false);
  });
});

describe("computeEffectiveJobStatus", () => {
  it("reinterprets an open job past its expiry as expired", () => {
    const job = { status: "open", expiryAt: new Date(NOW.getTime() - DAY_MS).toISOString() };
    expect(computeEffectiveJobStatus(job, NOW)).toBe("expired");
  });

  it("leaves an open job before its expiry untouched", () => {
    const job = { status: "open", expiryAt: new Date(NOW.getTime() + DAY_MS).toISOString() };
    expect(computeEffectiveJobStatus(job, NOW)).toBe("open");
  });

  it("never reinterprets a job that was manually paused, closed, or drafted — expiry only protects OPEN jobs", () => {
    const pastExpiry = new Date(NOW.getTime() - DAY_MS).toISOString();
    expect(computeEffectiveJobStatus({ status: "paused", expiryAt: pastExpiry }, NOW)).toBe("paused");
    expect(computeEffectiveJobStatus({ status: "closed", expiryAt: pastExpiry }, NOW)).toBe("closed");
    expect(computeEffectiveJobStatus({ status: "draft", expiryAt: pastExpiry }, NOW)).toBe("draft");
  });
});

describe("isJobOpenForPromotion — the one predicate future marketing systems must use", () => {
  it("is true only for a currently-open, non-expired job", () => {
    expect(isJobOpenForPromotion({ status: "open", expiryAt: null }, NOW)).toBe(true);
    expect(
      isJobOpenForPromotion({ status: "open", expiryAt: new Date(NOW.getTime() + DAY_MS).toISOString() }, NOW)
    ).toBe(true);
  });

  it("is false for an open-but-expired job, and for paused/closed/draft/expired jobs", () => {
    expect(
      isJobOpenForPromotion({ status: "open", expiryAt: new Date(NOW.getTime() - DAY_MS).toISOString() }, NOW)
    ).toBe(false);
    expect(isJobOpenForPromotion({ status: "paused", expiryAt: null }, NOW)).toBe(false);
    expect(isJobOpenForPromotion({ status: "closed", expiryAt: null }, NOW)).toBe(false);
    expect(isJobOpenForPromotion({ status: "draft", expiryAt: null }, NOW)).toBe(false);
    expect(isJobOpenForPromotion({ status: "expired", expiryAt: null }, NOW)).toBe(false);
  });
});

describe("isJobExpiringSoon", () => {
  it("is true for an open job expiring within the default 7-day window", () => {
    const job = { status: "open", expiryAt: new Date(NOW.getTime() + 3 * DAY_MS).toISOString() };
    expect(isJobExpiringSoon(job, NOW)).toBe(true);
  });

  it("is false once outside the window, already expired, or not open", () => {
    expect(isJobExpiringSoon({ status: "open", expiryAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString() }, NOW)).toBe(
      false
    );
    expect(isJobExpiringSoon({ status: "open", expiryAt: new Date(NOW.getTime() - DAY_MS).toISOString() }, NOW)).toBe(
      false
    );
    expect(isJobExpiringSoon({ status: "paused", expiryAt: new Date(NOW.getTime() + DAY_MS).toISOString() }, NOW)).toBe(
      false
    );
  });
});

describe("isValidJobStatusTransition — spec section 4 workflow", () => {
  it("allows the documented draft -> open -> paused -> open -> closed lifecycle", () => {
    expect(isValidJobStatusTransition("draft", "open")).toBe(true);
    expect(isValidJobStatusTransition("open", "paused")).toBe(true);
    expect(isValidJobStatusTransition("paused", "open")).toBe(true);
    expect(isValidJobStatusTransition("open", "closed")).toBe(true);
  });

  it("allows open -> expired (the system-driven transition)", () => {
    expect(isValidJobStatusTransition("open", "expired")).toBe(true);
  });

  it("allows re-opening an expired job (e.g. after extending its expiry) but not skipping straight from draft", () => {
    expect(isValidJobStatusTransition("expired", "open")).toBe(true);
    expect(isValidJobStatusTransition("draft", "closed")).toBe(false);
  });

  it("treats closed as terminal — no further transitions out", () => {
    expect(isValidJobStatusTransition("closed", "open")).toBe(false);
    expect(isValidJobStatusTransition("closed", "paused")).toBe(false);
  });

  it("allows a same-status no-op transition", () => {
    expect(isValidJobStatusTransition("open", "open")).toBe(true);
  });
});

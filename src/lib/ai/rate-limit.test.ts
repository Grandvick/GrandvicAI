import { beforeEach, describe, expect, it } from "vitest";
import { checkAndConsumeRateLimit, _resetRateLimitStateForTests } from "./rate-limit";

describe("checkAndConsumeRateLimit — abuse protection (spec section 16)", () => {
  beforeEach(() => {
    _resetRateLimitStateForTests();
    delete process.env.AI_RATE_LIMIT_PER_MINUTE;
  });

  it("allows requests up to the configured limit, then blocks with a retry hint", () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "3";
    const userId = "user-rate-1";

    expect(checkAndConsumeRateLimit(userId)).toEqual({ allowed: true });
    expect(checkAndConsumeRateLimit(userId)).toEqual({ allowed: true });
    expect(checkAndConsumeRateLimit(userId)).toEqual({ allowed: true });

    const blocked = checkAndConsumeRateLimit(userId);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("tracks separate users independently", () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = "1";
    expect(checkAndConsumeRateLimit("user-a").allowed).toBe(true);
    expect(checkAndConsumeRateLimit("user-a").allowed).toBe(false);
    expect(checkAndConsumeRateLimit("user-b").allowed).toBe(true);
  });

  it("defaults to a sane limit when AI_RATE_LIMIT_PER_MINUTE isn't set", () => {
    const userId = "user-rate-default";
    for (let i = 0; i < 10; i++) {
      expect(checkAndConsumeRateLimit(userId).allowed).toBe(true);
    }
    expect(checkAndConsumeRateLimit(userId).allowed).toBe(false);
  });
});

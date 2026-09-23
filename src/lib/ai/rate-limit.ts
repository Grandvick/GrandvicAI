import "server-only";

/**
 * Basic in-process rate limiting (spec section 16 — "keep it simple ... do
 * not introduce an external paid service"). A fixed-window counter per user
 * id, held in memory.
 *
 * Known limitation, documented rather than hidden: this resets on server
 * restart and does not coordinate across multiple server instances (e.g. a
 * multi-instance Vercel deployment) — each instance enforces its own
 * window. That's an acceptable gap for a single-owner/small-team dashboard
 * at Phase 3; a shared store (Redis, or a Supabase table) is the natural
 * upgrade path if this app is ever deployed with multiple concurrent
 * instances and abuse becomes a real concern — see CHANGELOG/DEVELOPMENT_PROGRESS.
 */

const WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 10;

function getMaxPerWindow(): number {
  const raw = process.env.AI_RATE_LIMIT_PER_MINUTE;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PER_WINDOW;
}

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Call once per incoming AI request, before calling the provider. */
export function checkAndConsumeRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const max = getMaxPerWindow();
  const existing = buckets.get(userId);

  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(userId, { windowStart: now, count: 1 });
    return { allowed: true };
  }

  if (existing.count >= max) {
    const retryAfterSeconds = Math.ceil((existing.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  existing.count += 1;
  return { allowed: true };
}

/** Test-only: clears all buckets so tests don't leak state into each other. */
export function _resetRateLimitStateForTests(): void {
  buckets.clear();
}

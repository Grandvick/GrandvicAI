/**
 * Grandvic AI — application configuration.
 *
 * This file centralizes settings that must never be hard-coded elsewhere in
 * the app (per the "future SaaS possibility" principle — Grandvic is the
 * first tenant, not baked into the codebase). Business-specific data
 * (company name, logo, contact info, job categories, etc.) belongs in the
 * `settings` and `businesses` database tables, seeded once via
 * supabase/seed.sql — NOT in this file. This file only holds
 * infrastructure-level defaults (which AI model to call, feature flags)
 * that are safe to version-control because they contain no business data
 * and no secrets.
 */

/**
 * Which AI provider implementation the app actually calls (Phase 4 — allows
 * local development/testing without live OpenAI billing/credits, per the
 * build spec). Controlled by a single explicit env var, `AI_PROVIDER`:
 *   - unset, or anything other than "mock" (default: "openai") — the real
 *     `OpenAiProvider` (src/lib/ai/provider/openai.ts). Used in production,
 *     and locally whenever a live model response is wanted.
 *   - "mock" — a deterministic, zero-cost, rule-based provider
 *     (src/lib/ai/provider/dev-mock.ts) that runs the exact same bounded
 *     tool-calling loop and real Phase 4 business logic (intent detection,
 *     job matching, qualification, lead scoring, conversation events, human
 *     takeover) without ever calling OpenAI. For local development/testing
 *     ONLY — never set this in a deployed/production environment, since it
 *     never gives a real answer.
 * This is a single explicit switch, never an automatic fallback: if the
 * real OpenAI call fails (e.g. no billing), it still fails loudly as
 * AiProviderError — the app never silently substitutes the mock for a
 * misconfigured or broken real provider, which would risk masking a genuine
 * outage. See src/lib/ai/provider/index.ts, the provider factory that reads
 * this.
 */
export const aiProviderConfig = {
  kind: (process.env.AI_PROVIDER === "mock" ? "mock" : "openai") as "mock" | "openai",
} as const;

/**
 * Which WhatsApp outbound provider implementation the app calls (Phase 5B —
 * deliberately mirrors `aiProviderConfig` above; Phase 5G adds the real
 * branch). Controlled by `WHATSAPP_PROVIDER`:
 *   - "mock" — `MockWhatsAppProvider` (src/lib/channels/whatsapp/provider/
 *     mock.ts), a zero-network, deterministic stand-in for local
 *     development/testing — the WhatsApp analog of `AI_PROVIDER=mock`.
 *   - anything else (including unset) — "meta", the real Graph API-backed
 *     `MetaWhatsAppProvider` (Phase 5G, src/lib/channels/whatsapp/provider/
 *     meta.ts) — same "anything other than mock means real" rule
 *     `aiProviderConfig` already uses for `AI_PROVIDER`. This is still NOT
 *     an automatic fallback in the risky sense: the factory
 *     (src/lib/channels/whatsapp/provider/index.ts) requires
 *     WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_API_VERSION to
 *     actually be set before constructing `MetaWhatsAppProvider` — missing
 *     any of them throws a clear WhatsAppConfigError rather than silently
 *     returning the mock, exactly like `getAiProvider()` does for a missing
 *     `OPENAI_API_KEY`.
 */
export const whatsAppProviderConfig = {
  kind: (process.env.WHATSAPP_PROVIDER === "mock" ? "mock" : "meta") as "mock" | "meta",
} as const;

/**
 * The three environment variables `MetaWhatsAppProvider` (Phase 5G) needs
 * to actually call the Graph API. Centralized here (rather than read
 * directly in provider/meta.ts) for the same reason every other config
 * value in this file is: one place to see what's required. `apiVersion` has
 * deliberately no hard-coded default — the Phase 5 plan explicitly flags
 * "the current Graph API version and its deprecation timeline" as something
 * to verify against Meta's current docs, never state confidently from
 * training data, so this app requires it to be set explicitly rather than
 * guessing a version number that could already be deprecated.
 */
export const whatsAppApiConfig = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  apiVersion: process.env.WHATSAPP_API_VERSION || null,
} as const;

/**
 * The two secrets the real inbound WhatsApp webhook route needs (Phase 5F —
 * src/app/api/webhooks/whatsapp/route.ts). Deliberately NOT part of
 * `whatsAppProviderConfig` above — that config is about OUTBOUND sending
 * (Phase 5B/5G); these two are inbound webhook AUTHENTICATION and are used
 * nowhere else. Per the Phase 5 plan, section I, they are two distinct
 * mechanisms: `verifyToken` proves endpoint ownership once, at Meta webhook
 * subscription time (the GET handshake); `appSecret` authenticates every
 * actual inbound POST via its `X-Hub-Signature-256` header. Both are
 * `null` (not empty-string) when unset, so the webhook route can fail
 * closed with a clear "not configured" response rather than silently
 * comparing against an empty string.
 */
export const whatsAppWebhookConfig = {
  appSecret: process.env.WHATSAPP_APP_SECRET || null,
  verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null,
} as const;

export const aiModelConfig = {
  /**
   * Default model for everyday assistant replies (customer Q&A, simple
   * lookups) — used by the AI Command Centre (Phase 3). Configurable via
   * env so it can change without a code edit — see section 45 "Cost
   * Control" of the build spec. `OPENAI_MODEL` is the primary env var
   * (matches OpenAI's own naming); `AI_MODEL_DEFAULT` is kept as a fallback
   * so any existing local setup using the earlier name keeps working.
   */
  default: process.env.OPENAI_MODEL || process.env.AI_MODEL_DEFAULT || "gpt-4o-mini",
  /** Cheapest/fastest model, for trivial classification-style calls (not yet used — reserved for a future phase). */
  fast: process.env.AI_MODEL_FAST || "gpt-4o-mini",
  /** Stronger model, reserved for complex reasoning (e.g. multi-opportunity matching, analytics narration — not yet used). */
  advanced: process.env.AI_MODEL_ADVANCED || "gpt-4o",
} as const;

/**
 * Feature flags. Each flag corresponds to a phase in DEVELOPMENT_PROGRESS.md.
 * Keeping them here (rather than scattering `if (process.env.X)` checks)
 * makes it obvious, in one place, what is and isn't wired up yet.
 */
export const features = {
  aiCore: true, // Phase 3 — built; still shows "not configured" in the UI until OPENAI_API_KEY is set
  aiSalesAgent: true, // Phase 4 — built; shares the /ai page's "not configured" gate (OPENAI_API_KEY) with aiCore
  whatsapp: false, // Phase 5
  automation: false, // Phase 6
  contentFactory: false, // Phase 7
  socialPublishing: false, // Phase 8
  analytics: false, // Phase 9
} as const;

/** Environment readiness checks — used to show "not configured" states instead of crashing. */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  hasSupabase: Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
  /**
   * Whether the AI Command Centre/Sales Agent endpoints have SOME usable
   * provider right now — either a real OpenAI key, or `AI_PROVIDER=mock`
   * (Phase 4 dev/test mode — see `aiProviderConfig` above). The two AI API
   * routes gate on this (not `hasOpenAI` directly) so local development/
   * testing works with `AI_PROVIDER=mock` even without an OpenAI key at
   * all. `hasOpenAI` itself is unchanged and keeps meaning exactly what it
   * says — the Settings page and health check still report the real
   * integration's status, not whether the mock happens to be standing in
   * for it.
   */
  hasAiProvider: Boolean(process.env.OPENAI_API_KEY) || aiProviderConfig.kind === "mock",
  hasWhatsApp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
};

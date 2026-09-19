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

export const aiModelConfig = {
  /**
   * Default model for everyday assistant replies (customer Q&A, simple
   * lookups). Configurable via env so it can change without a code edit —
   * see section 45 "Cost Control" of the build spec.
   */
  default: process.env.AI_MODEL_DEFAULT || "gpt-4o-mini",
  /** Cheapest/fastest model, for trivial classification-style calls. */
  fast: process.env.AI_MODEL_FAST || "gpt-4o-mini",
  /** Stronger model, reserved for complex reasoning (e.g. multi-opportunity matching, analytics narration). */
  advanced: process.env.AI_MODEL_ADVANCED || "gpt-4o",
} as const;

/**
 * Feature flags. Each flag corresponds to a phase in DEVELOPMENT_PROGRESS.md.
 * Keeping them here (rather than scattering `if (process.env.X)` checks)
 * makes it obvious, in one place, what is and isn't wired up yet.
 */
export const features = {
  aiCore: false, // Phase 3
  aiSalesAgent: false, // Phase 4
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
  hasWhatsApp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
};

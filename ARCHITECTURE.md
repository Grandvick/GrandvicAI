# ARCHITECTURE.md — Grandvic AI

This document explains *how* Grandvic AI is designed and *why*, so future
work (by Claude Code or any developer) stays consistent with the original
design intent instead of drifting phase by phase.

## 1. Guiding principles

1. **Grandvic is a tenant, not the codebase.** Company name, logo, contact
   details, job categories, fee schedules, etc. live in database rows
   (`businesses`, `business_modules`, `knowledge_items`, `settings`), seeded
   once via `supabase/seed.sql`. No file in `src/` should ever contain a
   hard-coded Grandvic phone number, price, or job title. This is what
   makes a future SaaS version possible without a rewrite (spec section 58)
   — though turning this into a multi-tenant SaaS product is explicitly
   **not** a current goal, just a constraint we design around.
2. **Modular, not monolithic.** The dashboard, AI core, CRM, marketing,
   recruitment, communications, automation, analytics, documents, payments,
   integrations, and settings are treated as separate concerns even though
   they currently live in one Next.js app. Business logic lives in
   `src/lib/business/*`, not scattered inside React components — components
   render, `lib` decides.
3. **Build in phases, ship a working app after each one.** See
   `DEVELOPMENT_PROGRESS.md`. A phase is not "done" until it builds, lints,
   passes its tests, and is documented.
4. **Never fabricate.** Nothing in this app invents jobs, prices, customer
   data, payments, documents, testimonials, or analytics. Where data isn't
   available yet, the UI says so explicitly (see `NotConfigured`, and the
   dashboard's error banner in `src/lib/business/dashboard.ts`) instead of
   showing plausible-looking fake numbers.
5. **The owner is the final authority.** High-impact actions (publishing,
   deleting, mass messaging, price changes, refunds) will always require
   explicit confirmation once the AI Core (Phase 3+) can perform them, unless
   the owner has explicitly turned on automatic execution for that specific
   action type.

## 2. High-level structure

```
GRANDVIC AI
  |
  +-- Dashboard            (src/app/(dashboard)/dashboard)
  +-- AI Core               [Phase 3]
  +-- CRM                   (src/app/(dashboard)/leads, /customers, /tasks) [Phase 1 — built]
  +-- Marketing             (src/app/(dashboard)/marketing, /calendar) [Phase 7]
  +-- Recruitment           (src/app/(dashboard)/jobs [Phase 2], /applications, /documents [Phase 1: basic tracking only])
  +-- Communications        (src/app/(dashboard)/inbox) [Phase 5]
  +-- Automation             [Phase 6, via n8n]
  +-- Analytics             (src/app/(dashboard)/analytics) [Phase 9]
  +-- Notifications         (Topbar bell + /notifications) [Phase 1 — built]
  +-- Payments              (src/app/(dashboard)/payments) [Phase 9+]
  +-- Integrations           [ongoing, per external service]
  +-- Settings              (src/app/(dashboard)/settings)
```

Business modules (data-level, via `businesses` + `business_modules` tables):

```
Grandvic Tours & Travel (seeded now)
  +-- Jobs Abroad / International Recruitment
  +-- Visa Services
  +-- Tours & Safaris

Grandvic Motors (schema-ready, not built — Phase 11)
  +-- Vehicle Sales, Imports, Financing, Insurance, After-sales, Spare Parts
```

## 3. Folder layout

```
grandvic-ai/
├── src/
│   ├── app/                       # Next.js App Router routes
│   │   ├── (dashboard)/           # Authenticated app shell + all business pages
│   │   ├── login/                 # Owner/staff sign-in
│   │   ├── auth/callback/         # Supabase email confirmation / OAuth redirect
│   │   ├── api/health/            # Basic status endpoint
│   │   └── page.tsx               # "/" — redirects to /dashboard or /login
│   ├── components/
│   │   ├── dashboard/             # Sidebar, Topbar, StatCard, ComingSoon, nav config
│   │   └── setup/                 # NotConfigured screen
│   ├── lib/
│   │   ├── supabase/              # client.ts (browser), server.ts (server/service-role),
│   │   │                          # middleware.ts (session refresh), types.ts (DB types)
│   │   ├── business/               # Business logic, one file per domain concern:
│   │   │                          # context.ts (current user + business scope), validation.ts
│   │   │                          # (Zod schemas), customers.ts, leads.ts, lead-events.ts,
│   │   │                          # pipeline-stages.ts, tasks.ts, applications.ts,
│   │   │                          # documents.ts, notifications.ts, hot-lead.ts, staff.ts,
│   │   │                          # businesses.ts, audit.ts, dashboard.ts, opportunities.ts
│   │   │                          # (read-only until Phase 2)
│   │   └── config.ts               # AI model config, feature flags, env readiness checks
│   └── proxy.ts                    # Next.js 16 "Proxy" (formerly Middleware) — auth session refresh
├── supabase/
│   ├── migrations/0001_init.sql             # Full initial schema (see section 5 below)
│   ├── migrations/0002_documents_storage.sql # Phase 1: private Storage bucket + RLS for documents
│   └── seed.sql                    # Roles, demo business, fictional demo data
└── (docs: README.md, SETUP.md, ARCHITECTURE.md, CHANGELOG.md, DEVELOPMENT_PROGRESS.md)
```

## 4. Why Next.js 16 changed a few things you might expect

This project uses a very recent Next.js release, which renamed/changed a
few conventions versus older tutorials:

- **`middleware.ts` → `proxy.ts`.** Same purpose (runs before every
  request), new file name and export name (`proxy` instead of
  `middleware`). See `src/proxy.ts`.
- **`cookies()` is async.** Every call site does `await cookies()`.
- **Typed routes (`LayoutProps<'/route'>`, `PageProps<'/route'>`)** are
  generated automatically (`next dev` / `next build` / `next typegen`) and
  used instead of manually typing `{ children: React.ReactNode }`.

If something in a tutorial you find online doesn't match this codebase,
check `node_modules/next/dist/docs/` first — it ships with docs for the
exact installed version, which is the most reliable source of truth.

## 5. Database design (Supabase / PostgreSQL)

Full schema: `supabase/migrations/0001_init.sql`. Design choices:

- **Everything hangs off `business_id`.** Every business-scoped table has a
  `business_id` foreign key to `businesses`, so the same schema serves
  multiple businesses (Grandvic Tours & Travel now, Grandvic Motors later)
  without duplicating tables.
- **Row Level Security (RLS) is on for every business-scoped table.** The
  `is_owner()` SQL helper function grants the Owner role unrestricted
  access; every other role is scoped to `current_business_id()` (their
  assigned business). As roles beyond Owner are actually built (Phase 1+),
  policies can be tightened further (e.g. a Sales Agent only seeing leads
  assigned to them) without changing the table structure.
- **No secrets in the database.** Social media OAuth tokens are stored only
  as `access_token_encrypted` (application-layer encryption before write —
  to be implemented alongside Phase 8, when a real token exists to encrypt).
  Payment provider keys, WhatsApp tokens, OpenAI keys, etc. live in
  environment variables only, never in a database table.
- **Full schema built now, most UI built later.** Tables like `content`,
  `payments`, `automation_rules` exist from Phase 0 so later phases are
  additive (new UI + a small migration for anything genuinely missing)
  rather than a redesign. This trades a little upfront modeling effort for
  avoiding painful schema migrations on live customer data later.
- **First user becomes Owner automatically.** See the `handle_new_user()`
  trigger — the very first row in `profiles` gets the `owner` role; every
  subsequent signup defaults to the least-privileged `staff` role and must
  be assigned a business + role by the owner.
- **Uploaded files follow the same business-scoping pattern as tables.**
  `supabase/migrations/0002_documents_storage.sql` (Phase 1) adds a
  private `documents` Storage bucket where every object is written at
  `<business_id>/<document_row_id>/<filename>`; its RLS policies read the
  business_id back out of that path (`storage_object_business_id()`) and
  check it against the caller's own business, exactly like every table
  policy above. Never store a file at a path that doesn't start with its
  owning business_id.

## 6. Authentication & authorization

- **Supabase Auth** (email/password for now) issues a session stored in
  cookies via `@supabase/ssr`.
- **`src/proxy.ts`** refreshes the session on every request and redirects
  signed-out visitors away from protected routes (an *optimistic* check,
  per Next.js's own authentication guidance).
- **Every page/action that touches real data** calls
  `createSupabaseServerClient()` itself and relies on Postgres RLS as the
  actual security boundary — the proxy redirect is a UX convenience, not
  the security layer.
- **`createSupabaseServiceRoleClient()`** exists for trusted server-only
  code (future webhook handlers, scheduled jobs) that must bypass RLS. It
  must never be imported into a Client Component and the key must never be
  prefixed `NEXT_PUBLIC_`.

## 7. AI architecture (Phase 3+, not built yet)

Planned design, so future phases build toward it consistently:

- **Tools, not one giant prompt.** The AI will call named, permission-
  checked functions (`search_leads`, `get_job`, `create_followup`, etc. —
  spec section 9) against `src/lib/business/*`, never query the database
  directly itself.
- **Structured knowledge retrieval**, not a single system prompt containing
  the whole business — see the `knowledge_items` table (categorized: FAQs,
  fees, policies, sales scripts, etc.).
- **Every AI call logged** to `ai_runs` (model, tokens, latency, estimated
  cost) for the observability/cost-control requirements in spec sections
  44-45.
- **Confirmation required for high-impact actions** (publishing, deleting,
  mass messaging, price/status changes, refunds) unless the owner has
  explicitly enabled automatic execution for that action type.
- **Configurable models**, never hard-coded — see `aiModelConfig` in
  `src/lib/config.ts`, driven by `AI_MODEL_DEFAULT` / `AI_MODEL_FAST` /
  `AI_MODEL_ADVANCED` env vars.

## 8. Integrations — abstraction, not lock-in

- **Payments**: the `payments` table has a `provider` column and no
  provider-specific fields — a specific provider's SDK will be isolated
  behind a small interface in `src/lib/integrations/payments/` once a
  provider is chosen with the owner (spec section 28 explicitly avoids
  hard-coding one provider into core logic).
- **Social publishing**: `social_accounts` + `publishing_jobs` are generic
  across Facebook, Instagram, TikTok, and LinkedIn. Each platform gets its
  own adapter under `src/lib/integrations/social/<platform>.ts` once built,
  implementing the same publish/status/failure-handling contract.
- **WhatsApp**: official WhatsApp Business Platform (Cloud API) only — no
  unofficial automation libraries, per spec section 17.
- **n8n**: orchestrates scheduling/follow-ups/webhooks; it calls into this
  app's API routes for anything touching the database or business logic —
  n8n itself never becomes the source of truth for business data.

## 9. Testing strategy

- **Unit tests** (Vitest) for business logic in `src/lib/business/*` — e.g.
  `dashboard.test.ts` proves the dashboard degrades gracefully when the
  database isn't reachable. As each phase adds real business rules (lead
  scoring, job expiry, pipeline transitions, follow-up timing), they get
  their own unit tests alongside the code, not retrofitted later.
- **Type checking** (`tsc --noEmit`) and **linting** (`eslint`) run as part
  of every phase's acceptance check.
- **Production build** (`next build`) must succeed before a phase is
  considered done — it catches issues unit tests and lint don't (e.g. a
  page that can't be rendered at all).
- **Integration/E2E tests** (webhooks, WhatsApp, n8n, the full
  enquiry→lead→hot-lead→notification flow) are added starting Phase 4/5,
  once there's a real flow to test end-to-end.

## 10. Secrets handling

- All secrets live in environment variables (`.env.local` locally, the
  hosting platform's environment variable settings in production) — never
  in source code, never in the database in plaintext, never in git.
- `SUPABASE_SERVICE_ROLE_KEY` and any future provider secret keys are
  server-only: they are never referenced in a file marked `"use client"`
  and never returned from an API response.
- Settings pages show *whether* an integration is configured (a boolean),
  never the secret value itself, once real credential storage is built.

## 11. What's deliberately not built yet

Anything in the master spec not listed as done in `DEVELOPMENT_PROGRESS.md`
is deliberately deferred to its assigned phase — this includes the AI Core,
WhatsApp, n8n automation, content generation, social publishing, analytics,
and Grandvic Motors. Building them now, out of order, would mean designing
against an incomplete foundation and re-doing work later.

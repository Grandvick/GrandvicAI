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
  +-- AI Core               (src/lib/ai, src/app/(dashboard)/ai, src/app/api/ai/chat) [Phase 3 — built: read-only tool-calling assistant]
  +-- CRM                   (src/app/(dashboard)/leads, /customers, /tasks) [Phase 1 — built]
  +-- Marketing             (src/app/(dashboard)/marketing, /calendar) [Phase 7]
  +-- Recruitment           (src/app/(dashboard)/jobs, /applications, /documents — Phase 2: full recruitment pipeline)
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
│   │   │                          # application-events.ts (Phase 2), documents.ts,
│   │   │                          # notifications.ts, hot-lead.ts, staff.ts, businesses.ts,
│   │   │                          # audit.ts (+ Phase 3: listRecentActivity), dashboard.ts,
│   │   │                          # jobs.ts (Phase 2 — job CRUD, status workflow, expiry logic),
│   │   │                          # job-documents.ts (Phase 2 — per-job document requirements),
│   │   │                          # settings.ts, knowledge.ts, conversations.ts (Phase 3 — first
│   │   │                          # readers/writers for tables that existed since Phase 0)
│   │   ├── ai/                     # Phase 3 — AI Core, provider-agnostic (see section 7 below):
│   │   │                          # types.ts, errors.ts, context.ts, core.ts, logging.ts,
│   │   │                          # rate-limit.ts, validation.ts, provider/ (openai.ts, mock.ts,
│   │   │                          # index.ts factory), tools/ (registry.ts, read-only.ts),
│   │   │                          # prompts/system.ts
│   │   └── config.ts               # AI model config, feature flags, env readiness checks
│   └── proxy.ts                    # Next.js 16 "Proxy" (formerly Middleware) — auth session refresh
├── supabase/
│   ├── migrations/0001_init.sql             # Full initial schema (see section 5 below)
│   ├── migrations/0002_documents_storage.sql # Phase 1: private Storage bucket + RLS for documents
│   ├── migrations/0003_jobs_abroad.sql       # Phase 2: full Jobs Abroad field set + recruitment pipeline
│   ├── migrations/0004_fix_owner_role_bootstrap.sql   # Phase 0 fix: owner-role bootstrap ordering
│   ├── migrations/0005_repair_missing_owner_profile.sql # Phase 0 fix: pre-existing Auth user, no profile row
│   ├── migrations/0006_ai_core.sql          # Phase 3: widens conversations.channel to allow 'dashboard'
│   └── seed.sql                    # Roles, demo business, fictional demo data (depends on 0003 — see SETUP.md)
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
- **Jobs Abroad extends Phase 0's `opportunities`/`applications` tables
  rather than duplicating them.** `supabase/migrations/0003_jobs_abroad.sql`
  (Phase 2) adds the full job field set to `opportunities`, expands
  `applications.status` into the recruitment pipeline, and adds one new
  table, `application_events` (mirrors `lead_events`, gives each application
  its own activity timeline). `document_requirements` (job → required
  document types) and `documents.application_id` (candidate → submitted
  documents for one specific application) already existed since Phase 0 and
  needed no new tables — see `src/lib/business/job-documents.ts`. See
  DEVELOPMENT_PROGRESS.md's Phase 2 entry for the full rationale.
- **Job expiry is enforced reactively, not by a scheduler.** There is no
  cron/background job runner in this app yet (that's Phase 10's "automatic
  job expiry sweeps"). Instead, `src/lib/business/jobs.ts` computes a job's
  *effective* status live from `status` + `expiry_at` on every read
  (`computeEffectiveJobStatus`), and opportunistically writes `status =
  'expired'` back to the row the first time a stale one is observed
  (`touchUpExpiredJobs`) — logging the change and firing one notification.
  Every caller (list, detail, the `/select` helper used when linking an
  application to a job) goes through this same computed status, so an
  expired job can never be read as "open" even if the write-back hasn't
  happened yet. `isJobOpenForPromotion()` is the single predicate any future
  marketing/recommendation/WhatsApp system must call before treating a job
  as available — never read `status === 'open'` directly.
- **Conversations carry structured state, not just message history**
  (`supabase/migrations/0007_ai_sales_agent.sql`, Phase 4). `conversations`
  gained `lead_id`, `intent` (plain text, not a Postgres enum — new sales
  intents never require a migration), `matched_opportunity_id`,
  `qualification jsonb` (shallow-merged per update — see
  `updateConversationState` in `src/lib/business/conversations.ts`), and
  `handover_reason`; `mode` widened from `('ai','human')` to
  `('ai','human','paused')` for the human-takeover state machine (spec
  section 16). A new table, `conversation_events`, mirrors
  `lead_events`/`application_events` exactly (id, `conversation_id` FK
  cascade, `event_type`, `payload jsonb`, `created_by`, `created_at`, same
  EXISTS-subquery RLS shape) and gives each conversation its own activity
  timeline (`intent_detected`, `lead_created`, `opportunity_matched`,
  `human_handover`, `ai_resumed`, etc.). **Deliberately not changed:**
  `leads.temperature` stays the existing 3-value enum (`hot`/`warm`/
  `nurture`) rather than widening to a literal 4-value HOT/WARM/COLD/
  NURTURE, because well over a dozen already-shipped Phase 1 UI files key
  off that 3-value shape. "Cold" is represented only as a display-only
  label computed at the application layer (`qualificationLabel()` in
  `src/lib/ai/qualification/scoring.ts`, triggered below score 15) —
  never written to the database. This is a deliberate, reasoned scope
  decision, documented in the migration file's own header comment, not an
  oversight.

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

## 7. AI architecture (Phase 3 + Phase 4 — built)

```
AI Command Centre UI (/ai)  or  Dashboard AI Assistant tools (future channels)
        |
        v
POST /api/ai/chat  (src/app/api/ai/chat/route.ts)
  1. authenticate + resolve business context (src/lib/ai/context.ts,
     reusing requireCurrentUser/resolveBusinessId — never a second auth path)
  2. rate-limit (src/lib/ai/rate-limit.ts)
  3. persist the user's message (src/lib/business/conversations.ts)
  4. runAiChat() — the bounded tool-calling loop (src/lib/ai/core.ts)
        |
        v
  AiProvider.chat()  (src/lib/ai/provider/openai.ts — the ONLY file that
  imports the OpenAI SDK; a second provider could be added behind the same
  `AiProvider` interface in src/lib/ai/types.ts without touching anything
  below this line)
        |
        v
  tool_calls?  --yes-->  executeTool() (src/lib/ai/tools/registry.ts)
        |                     |
        |                     v
        |               a registered AiToolDefinition (src/lib/ai/tools/read-only.ts)
        |               calls a real src/lib/business/*.ts function, using
        |               the SAME RLS-scoped Supabase client as every page —
        |               never the service-role client, never raw SQL
        |                     |
        |<--- tool result fed back to the model, loop repeats (max 4 rounds) --
        no
        v
  final natural-language reply
        |
        v
  persist the reply + log to ai_runs (src/lib/ai/logging.ts)
```

Design points:

- **Tools, not one giant prompt.** 17 read-only tools are registered in
  `src/lib/ai/tools/registry.ts` — `search_customers`, `get_customer`,
  `search_leads`, `get_lead`, `get_hot_leads`, `get_open_jobs`, `get_job`,
  `get_job_applicants`, `get_application`, `get_missing_documents`,
  `get_tasks`, `get_notifications`, `get_recent_activity`,
  `get_business_settings`, `search_knowledge_base`,
  `get_dashboard_summary`, `get_business_summary`. Every one calls an
  existing `src/lib/business/*` function (or a small new additive reader
  where none existed yet — `audit.ts`'s `listRecentActivity`,
  `settings.ts`, `knowledge.ts` — never a duplicate query). No tool takes a
  `businessId` argument — scope always comes from the authenticated
  session server-side, so the model literally cannot ask for another
  business's data through a tool argument (enforced by
  `registry.test.ts`). **No write/delete/send/publish tool is registered
  in Phase 3** — see the permission field on every `AiToolDefinition` and
  spec section 9/23.
- **RLS is still the real boundary.** Every tool runs through the same
  `createSupabaseServerClient()`-based, cookie-authenticated client every
  page and Server Action already uses (`src/lib/ai/context.ts`) — never
  the service-role client. The `business_id` filters inside each tool are
  defense in depth on top of RLS, not a replacement for it.
- **Structured knowledge retrieval**, not a single system prompt containing
  the whole business — `search_knowledge_base` reads the `knowledge_items`
  table (categorized: FAQs, fees, policies, sales scripts, etc.) on demand.
- **Every AI call logged** to `ai_runs` (model, tokens, latency, a simple
  estimated cost) via `src/lib/ai/logging.ts` — spec sections 44-45.
- **Conversations persisted** in the same `conversations`/
  `conversation_messages` tables a future WhatsApp/website inbox will use,
  under `channel = 'dashboard'` (`src/lib/business/conversations.ts`) — one
  unified inbox design, not a parallel AI-only table.
- **Read-only in Phase 3, carefully extended with writes in Phase 4.** The
  Phase 3 system prompt (`src/lib/ai/prompts/system.ts`) still tells the
  internal AI Assistant persona it has no create/update/delete/send/publish
  tools. Phase 4 adds a *separate* persona (the AI Sales Agent, see 7b
  below) with a small, explicit set of write tools — but even there,
  "confirmation required for high-impact actions" (this file's guiding
  principle #5) holds: every write is a named, schema-validated, audited
  tool, never a generic database-mutation capability, and several
  categories of action (deleting records, refunds, payment confirmation,
  approving/rejecting an applicant, closing a job, publishing content) are
  explicitly out of scope for the AI in this phase — see spec section 15
  and 7b's "High-risk actions" note below.
- **Configurable models**, never hard-coded — see `aiModelConfig` in
  `src/lib/config.ts`, driven by `OPENAI_MODEL` (primary) or
  `AI_MODEL_DEFAULT` / `AI_MODEL_FAST` / `AI_MODEL_ADVANCED` (fallbacks)
  env vars.
- **Cost control**: max 4 tool round-trips per request, an ~800-output-token
  cap per model call, conversation history capped at 12 prior messages, and
  a per-user in-memory rate limit (`AI_RATE_LIMIT_PER_MINUTE`, default
  10/minute) — see `src/lib/ai/core.ts` and `src/lib/ai/rate-limit.ts`.
  The rate limiter is intentionally simple (in-process, resets on restart,
  doesn't coordinate across multiple server instances) per spec section 16
  ("do not introduce an external paid service"); a shared store (Redis, or
  a Supabase table) is the natural upgrade if this is ever deployed with
  multiple concurrent server instances.

### 7b. AI Sales Agent — conversation engine (Phase 4 — built)

A second persona, sharing the same provider abstraction, tool registry,
bounded loop, and logging as 7 above, but with its own system prompt, its
own conversation history source, and a small set of write tools:

```
Customer message (dashboard-simulated "website" channel for now;
WhatsApp/other real channels plug into this same engine in a later phase)
        |
        v
POST /api/ai/sales-agent  (src/app/api/ai/sales-agent/route.ts)
  1. authenticate + resolve business context (same src/lib/ai/context.ts
     as the internal assistant — never a second auth path)
  2. rate-limit on a SEPARATE budget (`sales:<userId>`, same
     src/lib/ai/rate-limit.ts function, different key prefix)
  3. resolve or create the conversation (src/lib/business/conversations.ts)
  4. load conversation state + recent history FROM THE DATABASE
     (never trusted from the client, unlike the internal assistant's
     client-supplied history array — a stronger trust boundary on this
     customer-facing surface)
  5. persist the customer's message regardless of what happens next
  6. HARD GATE (in code, not just prompt wording): if conversation.mode
     is "human" or "paused", STOP HERE — runAiChat()/the provider is
     never called, and the response says so (aiResponded: false)
        |  (mode === "ai")
        v
  7. buildSalesAgentPrompt() (src/lib/ai/prompts/sales-agent.ts) — shares
     BASE_CORE_RULES with the internal assistant's prompt
     (src/lib/ai/prompts/rules.ts) plus sales-specific rules, and
     interpolates the conversation's current structured state so the model
     has continuity without re-deriving everything from raw history
  8. runAiChat() — the SAME bounded tool-calling loop as 7 above, over the
     SAME registry (src/lib/ai/tools/registry.ts = 17 read tools + 7 write
     tools, all 24 available to both personas)
        |
        v
  9. persist the reply, diff conversation state before/after to decide
     owner notifications (src/lib/ai/sales/notifications.ts), log to
     ai_runs with runType: "sales_agent"
```

Design points:

- **One registry, two personas.** `REGISTRY = [...READ_ONLY_TOOLS,
  ...WRITE_TOOLS]` in `src/lib/ai/tools/registry.ts` is shared by both
  `/api/ai/chat` (internal) and `/api/ai/sales-agent` (customer-facing) —
  the "same core can power Dashboard AI, WhatsApp AI, etc. without
  hard-coding any module" principle from the original Phase 3 spec, now
  structurally real rather than aspirational.
- **Seven write tools, every one wrapping existing business logic**
  (`src/lib/ai/tools/write.ts`): `find_customer_by_contact` (read),
  `create_customer`, `create_lead`, `update_lead`, `create_task`,
  `add_conversation_event`, `update_conversation_state`. None of them
  perform a direct database write — each one validates its input with a
  Zod schema, then calls the exact same `src/lib/business/*.ts` function a
  human-driven Server Action would call (`createCustomer`, `createLead`,
  `updateLeadPipeline`, `createTask`, ...). **No tool accepts `businessId`
  or `conversationId` as a schema field**, on top of the existing
  `businessId` rule from Phase 3 — both are resolved server-side and
  enforced by an automated scan across all 24 tools in
  `registry.test.ts`. **There is, and will never be, a generic
  `update_database`/`execute_sql` tool.**
- **Deterministic lead scoring, not a model-invented number**
  (`src/lib/ai/qualification/scoring.ts`, spec section 7/8). Six named,
  weighted factors — `intentClarity` (0.2), `fit` (0.2), `urgency` (0.15),
  `completeness` (0.15), `engagement` (0.15), `opportunityRelevance`
  (0.15), each 0–1, weights summing to 1.0 — combine into a 0–100
  integer score via `computeLeadScore()`. `recommendTemperature(score)`
  maps that score onto the existing 3-value DB enum
  (≥70 hot, 40–69 warm, <40 nurture); `qualificationLabel(score)` adds
  the spec's 4th display-only tier (<15 "cold") without touching the
  schema (see section 5 above). AI write tools take *qualification
  factors* as input, never a temperature or score directly — the
  conversion is entirely deterministic application code, so "the AI
  invents a score" is structurally impossible, not just discouraged by
  the prompt.
- **Structured sales intents**, not free-form guesses —
  `src/lib/ai/sales/intents.ts` defines a fixed `SALES_INTENTS` list
  (`GENERAL_ENQUIRY`, `JOB_ENQUIRY`, `VISA_ENQUIRY`, `TOUR_ENQUIRY`,
  `SAFARI_ENQUIRY`, `VEHICLE_ENQUIRY`, `PRICE_ENQUIRY`,
  `REQUIREMENTS_ENQUIRY`, `APPLICATION_STATUS`, `DOCUMENT_ENQUIRY`,
  `FOLLOW_UP`, `COMPLAINT`, `HUMAN_SUPPORT`, `OTHER`) validated by
  `update_conversation_state`'s Zod schema; `conversations.intent` itself
  is stored as plain text (not a Postgres enum) so adding a new intent in
  a later phase never requires a migration.
- **Open-job protection re-verified at write time, not just at read
  time** (spec section 11). `assertJobIsOpen()` in `write.ts` re-fetches a
  job's *live* `effectiveStatus` via the existing Phase 2
  `computeEffectiveJobStatus` logic immediately before it can be linked as
  `matched_opportunity_id` or used to auto-create an application — so a
  job that expires mid-conversation can never be (re)recommended, even if
  it looked open earlier in the same conversation.
- **Human takeover is a code-level gate, not a prompt instruction**
  (spec section 16). `conversations.mode` is `'ai' | 'human' | 'paused'`.
  When it isn't `'ai'`, `/api/ai/sales-agent/route.ts` returns before ever
  calling `runAiChat()` — the provider is simply never invoked, so there
  is no way for the model to "decide" to respond anyway. Three Server
  Actions (`src/app/(dashboard)/ai/sales-agent-actions.ts`) let a staff
  member take over, resume AI, or pause AI from the dashboard UI; the
  `update_conversation_state` AI tool explicitly refuses `mode: "ai"` —
  the AI can never resume itself, only a human action can. Every mode
  transition is logged as a `conversation_events` row
  (`human_handover`/`ai_resumed`) via `updateConversationState()` in
  `src/lib/business/conversations.ts`, the single place that function is
  implemented, called by both the AI tool and the Server Actions.
- **Bounded conversation memory** (spec section 17): the sales agent loads
  recent `conversation_messages` server-side (same `MAX_HISTORY_MESSAGES`
  cap as the internal assistant, `src/lib/ai/core.ts`), while durable
  structured facts (customer details, service interest, qualification
  answers) live separately in `conversations.qualification` (shallow-merged
  on every update, so a new answer never erases an earlier one) rather
  than being re-derived from raw chat history on every turn.
- **Owner notifications are diff-based, not per-message**
  (`src/lib/ai/sales/notifications.ts`, spec section 21).
  `evaluateOwnerNotifications()` compares conversation state before/after
  one request and only fires on genuine transitions — a lead newly
  becoming hot, a fresh handover to human, a fresh pause, a fresh
  complaint — deduplicated within the request and never re-firing while
  already in that state, mirroring the existing `shouldNotifyHotLead`
  pattern from Phase 1. This avoids notification spam on long
  conversations while still surfacing the events spec section 21 calls
  out.
- **Never claims an action happened unless it did** (spec section 18).
  The sales-agent system prompt (`src/lib/ai/prompts/sales-agent.ts`)
  explicitly instructs the model to only confirm a write after the
  corresponding tool call actually succeeded; write tools throw a typed
  `AiToolError` on failure (never silently no-op), which surfaces back
  through the loop as a failed tool result the model must react to
  honestly, not paper over.
- **High-risk actions remain entirely out of reach** (spec section 15):
  deleting a customer/lead/application, refunds, payment confirmation,
  approving/rejecting an applicant, changing a job's official
  requirements or status, and publishing public content have no
  corresponding tool anywhere in the registry — not disabled by
  configuration, simply never implemented, so there is nothing for a
  future prompt-injection or model mistake to invoke.
- **Testable without live OpenAI access** (spec section 25): every
  automated test — including the full `/api/ai/sales-agent` route — runs
  against the deterministic `MockAiProvider`, never the real OpenAI API,
  which matters because live billing/credits weren't active while Phase 4
  was built (see CHANGELOG.md and DEVELOPMENT_PROGRESS.md). The real
  `OpenAiProvider` remains fully wired behind the same `AiProvider`
  interface and is what the dashboard's "AI Sales Agent" tab actually
  talks to once `OPENAI_API_KEY` has active billing — nothing about the
  provider abstraction changed to work around the unavailable billing.
- **`AI_PROVIDER=mock` — a manual switch for using the AI Sales Agent tab
  itself without OpenAI billing** (a Phase 4 follow-up, distinct from the
  point above, which is about the *automated test suite*). Setting
  `AI_PROVIDER=mock` (see `aiProviderConfig` in `src/lib/config.ts`) makes
  `getAiProvider()` (`src/lib/ai/provider/index.ts`) return
  `DevRuleBasedProvider` (`src/lib/ai/provider/dev-mock.ts`) instead of
  `OpenAiProvider` — a single change in the one place both AI personas get
  their provider from, so neither route needed its own switch. Unlike
  `MockAiProvider` (which needs a hand-scripted sequence of exact responses
  and exists only to drive unit tests), `DevRuleBasedProvider` has no
  script: it reads the actual conversation and tool list it's given each
  call and reacts with simple keyword/regex heuristics — detecting a sales
  intent, calling `get_open_jobs`/`search_knowledge_base` for real data,
  capturing qualification via `update_conversation_state`, and even
  chaining `find_customer_by_contact` → `create_customer` → `create_lead`
  when a message plainly includes a name and contact details — so it
  exercises the real tool-calling loop and real Phase 4 business logic for
  whatever gets typed, not one fixed scenario. It never calls OpenAI and
  is documented as dev/test-only; it is never selected implicitly (a
  missing/broken `OPENAI_API_KEY` still throws `AiConfigError` exactly as
  before — only an explicit `AI_PROVIDER=mock` changes what the factory
  returns), so a real misconfiguration in production can never be silently
  masked by the mock. `env.hasAiProvider` (not `env.hasOpenAI`) gates both
  API routes and the `/ai` page, so this also works with no OpenAI key
  configured at all — see SETUP.md section 3b.

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
- **AI Core tests** (Phase 3) never call the real OpenAI API — a
  `MockAiProvider` (`src/lib/ai/provider/mock.ts`) scripts provider
  responses, and `src/test/fake-supabase.ts` is a small in-memory query
  builder for exercising the real tool handlers against realistic data
  shapes. Coverage includes tool registry integrity (no write tools, no
  `businessId` escape hatch, no SQL-execution capability), input
  validation, several real read-tool handlers, the bounded tool-call loop
  (including its round-trip ceiling and provider-error handling), rate
  limiting, `ai_runs` logging, and the `/api/ai/chat` route's auth/config/
  rate-limit/error responses.
- **Type checking** (`tsc --noEmit`) and **linting** (`eslint`) run as part
  of every phase's acceptance check.
- **Production build** (`next build`) must succeed before a phase is
  considered done — it catches issues unit tests and lint don't (e.g. a
  page that can't be rendered at all).
- **Integration/E2E tests** (webhooks, WhatsApp, n8n, the full
  enquiry→lead→hot-lead→notification flow) are added starting Phase 4/5,
  once there's a real flow to test end-to-end.
- **AI Sales Agent tests** (Phase 4), also entirely against the
  `MockAiProvider` — no automated test depends on live OpenAI billing.
  Coverage added: the deterministic scoring model (weights sum to 1.0,
  clamping, boundary values for temperature and the display-only "cold"
  label), every new write tool (customer/lead dedup, protected-field
  stripping proven by asserting bogus model-supplied fields never reach
  the underlying business-logic call, conversation-scoping requirement,
  job-still-open re-verification, intent/mode enum rejection, the AI's
  self-resume attempt being rejected), `updateConversationState`'s
  transition and qualification-merge behavior, owner-notification
  diffing (fires once per genuine transition, never on a no-op message),
  and the full `/api/ai/sales-agent` route (config/auth/validation
  errors, the human/paused hard gate proven by asserting `runAiChat` is
  never called, a successful end-to-end run, provider-error handling,
  and an independent rate-limit budget from the internal assistant). The
  registry integrity tests from Phase 3 were extended, not replaced —
  they now scan all 24 tools (17 read + 7 write) for the `businessId`
  escape hatch, a NEW `conversationId` escape hatch, and a forbidden-name
  pattern (`sql`, `execute`, `update_database`, `delete_*`, `refund`,
  `confirm_payment`, `update_application_status`, `approve_applicant`,
  `reject_applicant`, `close_job`, `publish_*`, `send_whatsapp`,
  `send_email`, ...) to keep the "no write tool this dangerous will ever
  be registered" guarantee enforced by a test, not just a code review.

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
is deliberately deferred to its assigned phase — this includes WhatsApp,
n8n automation, content generation, social publishing, analytics, and
Grandvic Motors, plus everything the AI Core doesn't do yet: write/action
tools (creating or changing records, sending messages, publishing),
long-term AI memory, and voice. Building them now, out of order, would
mean designing against an incomplete foundation and re-doing work later.

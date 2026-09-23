# DEVELOPMENT_PROGRESS.md — Grandvic AI

This tracks progress phase by phase, per the master build specification.
Each phase must be implemented, tested, documented, and left in a working
state before the next one starts.

Legend: ✅ done · 🔜 next · ⬜ not started

---

## Phase 0 — Project Foundation ✅ (this delivery)

**Goal:** Owner can run the project locally and log into the dashboard.

Built:
- Next.js 16 + TypeScript + Tailwind CSS v4 application (`create-next-app`,
  App Router, `src/` layout).
- Supabase integration: browser client, server client, service-role client,
  session-refresh proxy (`src/proxy.ts`), typed-but-permissive DB types
  pending real schema generation.
- Full initial database schema (`supabase/migrations/0001_init.sql`) —
  every table listed in the spec's database design section, with indexes,
  `updated_at` triggers, and Row Level Security policies scoped by
  business.
- Demo/seed data (`supabase/seed.sql`) — fictional, clearly labeled
  `[DEMO]`, safe to delete.
- Email/password authentication with automatic Owner bootstrap for the
  first user.
- Dashboard shell: sidebar (all planned sections, with "Phase N" badges on
  anything not built yet), topbar with sign-out, and a "Today's Overview"
  home page wired to real (currently mostly zero/demo) database counts.
- Settings page showing integration status (env vars present/absent) for
  Supabase, OpenAI, WhatsApp — without ever overclaiming a connection is
  "tested."
- Documentation: this file, README.md, SETUP.md, ARCHITECTURE.md,
  CHANGELOG.md, `.env.example`.
- Testing: Vitest configured, unit tests for the dashboard's data
  aggregation and graceful-failure behavior.
- Verified: `npm run lint`, `npx tsc --noEmit`, `npm run test`,
  `npm run build`, and a live boot of the production server all pass.

**Acceptance criteria:** ✅ Owner can run `npm run dev` locally and log into
the dashboard (once a Supabase project + owner user are created per
SETUP.md).

**Known limitations / what's intentionally not here yet:**
- No real CRUD screens for leads, customers, jobs, etc. — data can only be
  seen (via the dashboard counts) or edited directly in Supabase's Table
  Editor until Phase 1/2 build proper UI.
- `src/lib/supabase/types.ts` is a loose placeholder — regenerate it with
  the Supabase CLI once your project is set up, for real autocomplete/type
  safety on queries.
- `npm audit` reports 2 moderate advisories in `vitest`'s dev-only
  dependency chain (path traversal in `@vitest/mocker`, dev/test-time only,
  not shipped to production). Fixing requires the vitest 5 major version
  bump, deferred to avoid destabilizing the toolchain mid-foundation;
  revisit at the start of Phase 1.
- Sidebar/nav includes every future section per spec section 53 for
  visibility into the full roadmap, but most link to "Coming in Phase N"
  placeholders rather than 404s.

**What we need from you before Phase 1:** nothing blocking — Phase 1 is
pure application code (CRM screens) against the schema already built.
Useful to have ready when you want a "real" look: your actual Supabase
project created, and any real business details (logo, contact info, fee
schedule) you'd like reflected instead of the placeholder demo business.

---

## Phase 1 — CRM + Database ✅ (this delivery)

**Goal:** Owner can manually create and manage customers, leads, tasks, and
related records through real CRM screens backed by the live database.

Built:
- **Customers** — list (search by name/phone/email), create, and a detail
  page showing the editable profile plus every lead/task/application/
  document linked to that customer.
- **Leads** — list with a Kanban pipeline board (drag a card between
  configurable stages, backed by `pipeline_stages` with a sane fallback
  pipeline when none are configured yet) and a filterable table view;
  create; a detail page with inline stage/temperature/score/assignment
  editing, a note field, and a full activity timeline read from
  `lead_events`.
- **Tasks** — list with a status filter and inline status changes, create
  (optionally linked to a customer or lead).
- **Applications** — lightweight status tracking (draft → submitted →
  under review → interview → accepted/rejected/withdrawn), optionally
  linked to a lead and/or an opportunity. Deliberately does **not** include
  job-matching, requirement checklists, or expiry handling — those are
  Phase 2's Jobs Module.
- **Documents** — request a document from a customer, upload it to a
  private Supabase Storage bucket (new migration, see below), track its
  status through to approved/rejected, and view it via a short-lived (60s)
  signed URL. Deliberately does **not** include AI "looks complete"
  checks or per-opportunity document requirements — also Phase 2.
- **Notifications** — a bell in the Topbar (unread badge, dropdown,
  mark-read/mark-all-read) plus a dedicated `/notifications` page.
  Automatically fires a "🔥 Hot lead" notification the moment a lead's
  temperature transitions into `hot` (not on every save, and not on leads
  created already hot from elsewhere — this is a simple transition rule,
  not the AI lead-scoring engine, which is Phase 4).
- **Activity log** — every create/update mutation in this phase
  (customers, leads, tasks, applications, documents) writes an
  `audit_logs` row via a shared `logActivity()` helper; lead-specific
  changes additionally get a human-readable entry in `lead_events` for the
  lead detail page's timeline.
- **New migration**: `supabase/migrations/0002_documents_storage.sql` —
  creates the private `documents` Storage bucket and its RLS policies
  (business-scoped, same pattern as every table policy in `0001_init.sql`).
  **You need to run this once in the Supabase SQL Editor** — see SETUP.md
  section 3, step 3. Nothing in `0001_init.sql` changed.
- Server-side validation (Zod) for every mutation, centralized in
  `src/lib/business/validation.ts` and re-used by both the server actions
  and their unit tests.
- 29 unit tests covering the new validation schemas, the hot-lead
  notification transition rule, document file validation, pipeline-stage
  fallback/de-duplication, and the customer lead-count aggregate mapping.

**Acceptance criteria:** ✅ Owner can manually create and manage customers
and leads (plus tasks, basic applications, and documents) end to end
through the UI, with every change reflected in the activity log.

**Known limitations / what's intentionally not here yet:**
- Applications and documents are basic status trackers only — full job
  matching, requirement checklists, and expiry enforcement arrive with
  Phase 2's Jobs Module, per the master spec's phase boundaries.
- "Assigned to" / task ownership selectors list every staff profile
  scoped to the business (plus the Owner); fine-grained role-based
  permissions beyond Owner vs. scoped-staff are not yet enforced in the
  UI (e.g. any authenticated staff member can currently set a document's
  status to `approved`).
- The customer detail page's linked-leads list is fetched by pulling all
  of the business's leads and filtering client-side rather than a
  dedicated filtered query — fine at today's data volumes, worth
  revisiting if a business accumulates thousands of leads.
- No pagination yet on any list view (customers, leads, tasks,
  applications, documents, notifications) — fine at today's data volumes.
- The "Assigned to" business-switcher / multi-business staff assignment
  UI still doesn't exist; `resolveBusinessId()` continues to default the
  Owner to the first business row, same as Phase 0.

**What we need from you before Phase 2:** run the new
`0002_documents_storage.sql` migration (see above) if you want to test
document uploads. Nothing else was blocking — Phase 2 turned out to need
one small additive migration of its own (`0003_jobs_abroad.sql`, see its
entry below) rather than being pure application code, since the full Jobs
Abroad field set and recruitment pipeline needed more columns than Phase 0
had anticipated.

## Phase 2 — Jobs Abroad Recruitment & Opportunity Management ✅ (this delivery)

**Goal:** Owner can create and manage overseas job opportunities end to end
— post a job, control its status and expiry, define what documents it
requires, and track candidates through a full recruitment pipeline — with
expired/paused/closed jobs automatically protected from ever being treated
as available.

Built:
- **Jobs** — a new `/jobs` section: searchable/filterable list (status,
  country, category, sort by deadline or newest) with a live summary panel
  (total/open/paused/expiring-soon/expired/closed jobs, total applications,
  new applicants, candidates awaiting documents/interview); a structured
  create/edit form (Basic Information, Employment, Requirements, Benefits,
  Application, Description, Internal — matching the spec's field groups); a
  detail page showing key facts, requirements, benefits, description,
  required documents, and every applicant with their stage and any missing
  mandatory documents; status actions (Draft → Pending Review/Open → Open →
  Paused → Open → Closed, plus system-driven → Expired) enforced by a pure,
  unit-tested transition rule; and a "Duplicate job" action that copies a
  job's descriptive fields and document requirements into a fresh Draft
  **without** copying its applications, candidates, audit history, or
  publishing timestamps — `src/app/(dashboard)/jobs/**`,
  `src/lib/business/jobs.ts`.
- **Job expiry protection** — enforced reactively (there's no scheduler in
  this app yet; see Phase 10 below), not by trusting the stored `status`
  column. Every read path computes the job's *effective* status live from
  `status` + `expiry_at`, and the very first time an `open` job is observed
  past its expiry, its stored status is opportunistically corrected to
  `expired` (logged, one notification fired, never a silent delete).
  `isJobOpenForPromotion()` is the single function any future
  marketing/recommendation/WhatsApp system must call — see
  `src/lib/business/jobs.ts` and ARCHITECTURE.md section 5.
- **Recruitment pipeline** — `applications.status` expanded from Phase 1's
  basic tracker into the full pipeline (new → screening →
  documents_pending/documents_complete → shortlisted →
  submitted_to_recruiter → interview_scheduled → interview_completed →
  selected → offer_received → visa_processing → deployment_pending →
  placed, or rejected/withdrawn with an optional reason), extending the
  existing `applications` table rather than creating a parallel one. A new
  `application_events` table (mirrors Phase 1's `lead_events`) gives every
  application its own activity timeline, shown on a new
  `/applications/[id]` detail page alongside its document checklist —
  `src/lib/business/applications.ts`, `src/lib/business/application-events.ts`.
- **Job-specific document requirements** — a flexible, not-hard-coded model
  built on Phase 0's existing `document_requirements` table: an owner adds
  any document type (free text, with common ones offered as autocomplete
  suggestions only) and marks it mandatory or optional per job. Each
  candidate application's checklist (Required/Submitted/Missing/Approved/
  Rejected) is computed live by joining that job's requirements against the
  documents actually submitted for that specific application —
  `src/lib/business/job-documents.ts`.
- **Notifications** (via the existing Phase 1 notification system, kept
  deliberately short to avoid spamming): new application received, job
  expired, candidate moved to interview, candidate selected, and all of a
  candidate's mandatory documents approved.
- **Audit logging** — every job create/update/status-change/duplicate,
  document-requirement add/remove, and application create/status-change is
  logged via the existing `logActivity()` → `audit_logs`, alongside the new
  per-application event timeline.
- **New migration**: `supabase/migrations/0003_jobs_abroad.sql` — extends
  `opportunities` with the full Jobs Abroad field set and `applications`
  with the pipeline above (migrating old status values forward, not
  discarding them), adds `application_events`, and adds the indexes/
  constraints listed in ARCHITECTURE.md. **Action needed:** run this once in
  the Supabase SQL Editor, after `0002_documents_storage.sql` and before
  `supabase/seed.sql` — see SETUP.md section 3.
- 24 new unit tests: the job status-transition rule, expiry/effective-status
  computation (including "expiry only affects OPEN jobs"), "expiring soon"
  detection, and the new Zod schemas (`jobSchema`,
  `jobDocumentRequirementSchema`, the expanded `applicationSchema`).

**Acceptance criteria:** ✅ Owner can create a job opportunity, mark it OPEN,
and it's retrievable as open; pausing/closing it (or its expiry date
passing) removes it from what any future recommendation system would treat
as available, while the job and its historical applications/documents
remain fully visible internally.

**Known limitations / what's intentionally not here yet:**
- "Job nearing expiry" is surfaced visually (the Jobs list's "Expiring
  soon" count, computed live) but does **not** yet fire a push notification
  the way "job expired" does — doing that without spamming the owner needs
  either a stored last-notified flag or a real scheduler, and building a
  proper one is Phase 10's "automatic job expiry sweeps." The pure
  `isJobExpiringSoon()` function Phase 10 will need already exists and is
  unit-tested.
- No fine-grained role permissions beyond Owner vs. scoped-staff yet (same
  limitation as Phase 1) — any authenticated staff member can change a
  job's status or an application's stage.
- No pagination on the jobs/applications lists yet (same as every other
  Phase 1 list) — fine at today's data volumes.
- The applicants list on a job's detail page computes each candidate's
  missing-document count with one query per applicant rather than a single
  batched query — fine at today's scale, worth revisiting if a job
  accumulates hundreds of applicants.
- Document type suggestions on the job document-requirements editor are a
  fixed starter list (passport, CV, academic certificates, etc.) offered
  only as autocomplete hints — any free-text value is accepted, per spec
  section 10's "do not hard-code" requirement.

**What we need from you before Phase 3:** run the new
`0003_jobs_abroad.sql` migration (see above), after `0002` and before
`seed.sql`, if you haven't already. Nothing else is blocking — Phase 3 (AI
Core) needs an OpenAI API key when it starts (see SETUP.md section 7) but
no other Phase 2 follow-up.

**Post-delivery data fixes (not new features, not Phase 3):** two Phase 0
bootstrap gaps surfaced once real testing began and were fixed with new,
narrowly-scoped migrations rather than app-code changes, since
`resolveBusinessId()`/`handle_new_user()` were both already correct —
`0004_fix_owner_role_bootstrap.sql` (a profile existed but its role lookup
raced `seed.sql`) and `0005_repair_missing_owner_profile.sql` (an Auth user
created before `0001_init.sql` ever ran had no profile row at all, since
the bootstrap trigger didn't exist yet to react to that signup). See
CHANGELOG.md `[0.3.1]`/`[0.3.2]` and SETUP.md's Troubleshooting section for
the full detail. Both are idempotent and safe to run on an already-healthy
database.

## Phase 3 — AI Core ✅ (this delivery)

Built: a provider-agnostic AI service layer (`src/lib/ai/`), a registry of
17 read-only business tools, a modular system-prompt layer, `ai_runs`
logging, conversation persistence, rate limiting, and the first UI —
the AI Command Centre at `/ai`, plus a small "Ask Grandvic AI" widget on
the dashboard.

**Architecture** (see ARCHITECTURE.md section 7 for the full diagram):
`POST /api/ai/chat` → authenticate + resolve business context (reusing
`requireCurrentUser`/`resolveBusinessId`, never a second auth path) → rate
limit → a bounded tool-calling loop (`src/lib/ai/core.ts`, max 4 tool
round-trips) → `AiProvider.chat()` (`src/lib/ai/provider/openai.ts` — the
only file that imports the OpenAI SDK, behind a provider-agnostic
interface so a second provider could be added later) → any requested tool
runs through `executeTool()` (`src/lib/ai/tools/registry.ts`), which
validates input with Zod and calls a real `src/lib/business/*` function
using the SAME RLS-scoped Supabase client every page already uses — never
the service-role client, never raw SQL, and no tool accepts a `businessId`
argument from the model.

**Tools** (all read-only, spec section 9): `get_dashboard_summary`,
`get_business_summary`, `search_customers`, `get_customer`, `search_leads`,
`get_lead`, `get_hot_leads`, `get_open_jobs`, `get_job`,
`get_job_applicants`, `get_application`, `get_missing_documents`,
`get_tasks`, `get_notifications`, `get_recent_activity`,
`get_business_settings`, `search_knowledge_base`. Every one wraps an
existing business-logic function; three small additive readers were added
because no reader existed yet for tables that have existed since Phase 0
(`audit.ts`'s `listRecentActivity`, the new `settings.ts`, the new
`knowledge.ts`) — no duplicated query logic, no new tables.

**No write capability.** There is no create/update/delete/send/publish
tool registered, and the system prompt explicitly tells the model to say
so plainly if asked to perform an action rather than pretending to.
`registry.test.ts` asserts this structurally (exact allow-list of tool
names, every one classified `permission: "read"`, no `businessId` field in
any tool's input schema).

**New migration** `supabase/migrations/0006_ai_core.sql` — adds no new
tables (`ai_runs`, `audit_logs`, `settings`, `knowledge_items`,
`conversations`/`conversation_messages` and their RLS already existed
since Phase 0); it only widens `conversations.channel` to also accept
`'dashboard'`, so an AI Command Centre conversation is stored the same way
a future WhatsApp/website conversation will be — one unified inbox design,
not a parallel table. **Action needed:** run this once in the Supabase SQL
Editor, after `0005` and (for a fresh project) after `seed.sql` — see
SETUP.md section 3.

**Requires:** an OpenAI API key — see SETUP.md section 3a. Until
`OPENAI_API_KEY` is set, `/ai` shows a clear "isn't configured yet" message
(same pattern as every other integration status check in this app) instead
of a broken page.

**Verified:**
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 90/90 passing (14 test files; 37 new tests for the AI
  Core, none of which call the real OpenAI API — a `MockAiProvider` and a
  small fake Supabase query builder exercise the real code paths instead).
- `npm run build` — succeeds; `/ai` and `/api/ai/chat` correctly forced
  dynamic, alongside every existing route.
- `0006_ai_core.sql` dry-run tested against a local PostgreSQL 16 instance:
  applied cleanly on top of `0001`–`0005` + seed, a `channel = 'dashboard'`
  conversation insert succeeds, existing channel values still work, an
  invalid channel is still rejected, and the migration is safely
  re-runnable (verified by running it twice).

**Acceptance test** (spec section 25) — from `/ai`: "Show me the currently
open jobs" uses `get_open_jobs` and answers with real data; "How many jobs
are currently open?" gives an actual count; "Which applicants are missing
documents?" uses `get_missing_documents` with real recruitment data; "Show
me my hot leads" uses `get_hot_leads`; "Give me a summary of today's
recruitment activity" uses `get_dashboard_summary`/`get_recent_activity`
and says plainly if there's nothing to report; "Delete this customer" is
refused/explained rather than executed (no delete tool exists); "Send a
WhatsApp message to this applicant" is explained as not yet enabled rather
than pretended.

**Known limitations / what's intentionally not here yet:**
- No write/action tools yet (create, update, delete, send, publish) — that
  arrives with Phase 4+ alongside the confirmation/approval-workflow layer
  this file's guiding principle #5 requires for high-impact actions; there
  is nothing to confirm yet because there is nothing the AI can do besides
  read.
- No streaming responses — the AI Command Centre waits for the full reply
  rather than showing tokens as they arrive. A reasonable UX trade for
  Phase 3's scope; worth revisiting if replies start feeling slow.
- Rate limiting is a simple in-process counter (`src/lib/ai/rate-limit.ts`)
  — resets on server restart and doesn't coordinate across multiple
  concurrent server instances. Fine for a single-owner/small-team
  deployment; a shared store (Redis, or a Supabase table) is the upgrade
  path if this is ever deployed multi-instance.
- Cost estimates in `ai_runs.cost_estimate` use a small hard-coded
  per-model USD/1K-token table (`src/lib/ai/logging.ts`) rather than a live
  pricing API — `null` (not a guess) for any model not in that table.
- No fine-grained per-role tool restrictions yet — any authenticated staff
  member who reaches `/ai` can call any of the 17 read tools, scoped to
  their business by RLS exactly like the rest of the app, but not further
  restricted by role (e.g. a Sales Agent could ask about job applicants).
  Worth revisiting alongside Phase 1's same "no fine-grained role
  permissions yet" limitation.

**What we need from you before Phase 4:** run the new
`0006_ai_core.sql` migration (see above) if you haven't already, and add
`OPENAI_API_KEY` to try the AI Command Centre (optional — everything else
in this app works without it). Nothing else is blocking.

## Phase 4 — AI Sales Agent ✅ (this delivery)

Built: a second AI persona — the AI Sales Agent — sharing Phase 3's
provider abstraction, tool registry, and bounded loop, plus everything
that persona needed to actually act on the CRM: 7 new write tools, a
deterministic lead-qualification/scoring engine, structured sales
intents, a human-takeover state machine, a per-conversation event
timeline, diff-based owner notifications, and a new "AI Sales Agent" tab
on `/ai` for trying it out (dashboard-simulated, since no real customer
channel exists yet).

**Architecture** (see ARCHITECTURE.md section 7b for the full diagram):
`POST /api/ai/sales-agent` → authenticate + resolve business context
(same `src/lib/ai/context.ts` as Phase 3, never a second auth path) → rate
limit on a separate budget from the internal assistant → resolve/create
the conversation → load conversation state + recent history from the
database (never trusted from the client) → persist the customer's
message → **hard gate**: if the conversation is in `human` or `paused`
mode, stop here — the AI provider is never called — otherwise build the
sales-agent system prompt (interpolating current conversation state) and
run the same bounded tool-calling loop from Phase 3 (`runAiChat()`, now
parameterized by an explicit `systemPrompt` so both personas share it) →
persist the reply → diff conversation state before/after to decide owner
notifications → log to `ai_runs`.

**7 new write tools** (`src/lib/ai/tools/write.ts`), the AI's first write
capability, every one wrapping an existing `src/lib/business/*` function
rather than touching the database directly: `find_customer_by_contact`
(read), `create_customer`, `create_lead` (dedups against an existing
active lead for the same customer before creating a new one, re-verifies
a target job is genuinely OPEN via `assertJobIsOpen()` before linking it,
computes score/temperature deterministically — never accepts them as
input), `update_lead` (pipeline stage/notes/qualification factors only —
no raw temperature or score field exists on its schema, so even a
model-supplied one is silently dropped before reaching the database),
`create_task`, `add_conversation_event`, `update_conversation_state` (the
human-takeover mechanism — explicitly refuses `mode: "ai"`, so the AI can
never resume itself). Combined with Phase 3's 17 read tools, the shared
registry (`src/lib/ai/tools/registry.ts`) now has **24 tools total**,
available to both the AI Assistant and the AI Sales Agent. **There is,
and will never be, a generic `update_database`/`execute_sql` tool** — and
neither tool set can delete a record, issue a refund, confirm a payment,
approve/reject an applicant, change a job's official requirements or
status, or publish public content (spec section 15) — those categories
simply have no corresponding tool anywhere in the registry.

**Deterministic lead qualification & scoring**
(`src/lib/ai/qualification/scoring.ts`): six named, weighted, documented
factors — intent clarity (0.2), fit (0.2), urgency (0.15), completeness
(0.15), engagement (0.15), opportunity relevance (0.15); weights sum to
1.0 — combine into a 0–100 integer score. That score deterministically
maps onto the existing `hot`/`warm`/`nurture` temperature enum
(≥70/40–69/<40) plus a display-only 4th "cold" tier below 15 for UI
labeling only. The AI never supplies a score or temperature directly —
only qualification factors — so "the model invents a number" is
structurally impossible, not just discouraged by the prompt.

**Structured sales intents** (`src/lib/ai/sales/intents.ts`): 14 fixed
categories — `GENERAL_ENQUIRY`, `JOB_ENQUIRY`, `VISA_ENQUIRY`,
`TOUR_ENQUIRY`, `SAFARI_ENQUIRY`, `VEHICLE_ENQUIRY`, `PRICE_ENQUIRY`,
`REQUIREMENTS_ENQUIRY`, `APPLICATION_STATUS`, `DOCUMENT_ENQUIRY`,
`FOLLOW_UP`, `COMPLAINT`, `HUMAN_SUPPORT`, `OTHER` — stored as plain text
on `conversations.intent` (not a Postgres enum), so a future intent never
needs a migration.

**Human takeover**, implemented as a code-level gate, not just a prompt
instruction: `conversations.mode` widened to `'ai' | 'human' | 'paused'`.
While it isn't `'ai'`, `/api/ai/sales-agent` returns before ever calling
the AI provider — the customer's message is still saved so a human can
see and answer it. Three new Server Actions
(`src/app/(dashboard)/ai/sales-agent-actions.ts`) let a staff member take
over, resume AI, or pause AI from the new dashboard panel; every
transition is written once, in `updateConversationState()`
(`src/lib/business/conversations.ts`), and logged as a `conversation_events`
row (`human_handover`/`ai_resumed`) — called by both the AI tool and the
Server Actions, so there's one place this logic lives, not two.

**`conversation_events`** (new table, mirrors `lead_events`/
`application_events` exactly): a per-conversation timeline —
`intent_detected`, `qualification_started`, `qualification_completed`,
`lead_created`, `lead_updated`, `opportunity_matched`,
`document_requirement_discussed`, `application_status_requested`,
`human_handover`, `ai_resumed`, `follow_up_required` — useful for future
analytics and visible in the new dashboard panel today.

**Owner notifications for AI-driven events**
(`src/lib/ai/sales/notifications.ts`, spec section 21): diff-based against
conversation state before/after one request, so it fires once per genuine
transition — a lead newly becoming hot, a fresh handover to a human, a
fresh pause, a fresh complaint — and never repeats while already in that
state. This mirrors the existing `shouldNotifyHotLead` pattern from
Phase 1 rather than inventing a second notification mechanism.

**New migration** `supabase/migrations/0007_ai_sales_agent.sql` — widens
`conversations.mode`; adds `lead_id`, `intent`, `matched_opportunity_id`,
`qualification`, `handover_reason` columns to `conversations`; adds the
`conversation_events` table with its own RLS policy and indexes. No
existing table, column, or policy is touched. **Action needed:** run this
once in the Supabase SQL Editor, after `0006` — see SETUP.md section 3.

**New UI**: an "AI Sales Agent" tab on `/ai` (next to the existing "AI
Assistant" tab) — a chat panel styled distinctly from the internal
assistant, plus a live side panel showing conversation mode, detected
intent, the linked lead (temperature + score, linking to `/leads/:id`),
the matched OPEN opportunity (linking to `/jobs/:id`), captured
qualification details, takeover controls, and the recent
conversation-events timeline — see SETUP.md section 3b for a walkthrough,
including the spec's worked example ("I am a physiotherapist and I'm
interested in Somalia").

**Requires:** the same `OPENAI_API_KEY` as Phase 3 — no separate key or
gate. Until it's set, both `/ai` tabs show the same "isn't configured yet"
message.

**Verified:**
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 150/150 passing (19 test files; 60 new tests for
  Phase 4, none of which call the real OpenAI API — the deterministic
  `MockAiProvider` and the fake Supabase query builder exercise every new
  code path instead).
- `npm run build` — succeeds; `/api/ai/sales-agent` correctly forced
  dynamic, alongside every existing route.
- `0007_ai_sales_agent.sql` dry-run tested against a local PostgreSQL 16
  instance: applied cleanly on top of `0001`, `0003`–`0006` + seed (`0002`
  skipped — it's Supabase Storage bucket setup, unrelated to this
  migration's tables), idempotent re-run confirmed, `ai`→`paused`→`human`
  mode transitions all succeed, an invalid mode value is still rejected by
  the check constraint, and a `conversation_events` insert succeeds and is
  queryable under RLS.

**Acceptance test** (spec section 19) — from the AI Sales Agent tab:
"Hi, I want to work abroad" asks a qualifying question rather than
dumping every open job; "I am a physiotherapist and I'm interested in
Somalia" searches OPEN opportunities, identifies a relevant one if one
exists, explains its real (never invented) requirements, asks a
qualification question, and — once enough is known — creates or updates a
lead with a deterministically computed temperature/score, matches the
opportunity, and (where appropriate) creates a follow-up task; a hot lead
or a human-support request produces exactly one owner notification, not
one per message; taking over the conversation from the side panel stops
the AI from auto-replying until it's resumed.

**Known limitations / what's intentionally not here yet:**
- **Live OpenAI calls were not exercised in this environment.** OpenAI
  billing/credits are not active on the configured account, so this
  phase — like Phase 3 — was built and tested entirely against the
  `MockAiProvider`. The real `OpenAiProvider` remains fully wired behind
  the same `AiProvider` interface and is exactly what the dashboard calls
  once billing is active; nothing about the provider abstraction changed
  to work around the unavailable billing. Please try the AI Sales Agent
  tab yourself once `OPENAI_API_KEY` has active billing, and report back
  anything that looks off.
- `leads.temperature` intentionally stays the existing 3-value enum
  (`hot`/`warm`/`nurture`) rather than the spec's literal 4-value HOT/
  WARM/COLD/NURTURE model — "cold" is a display-only label computed in
  application code (`qualificationLabel()`), never written to the
  database. This is because 15+ already-shipped Phase 1 UI files key off
  the 3-value shape; widening the enum would have meant touching all of
  them for a label that only needs to exist in one place (the AI Sales
  Agent panel). See ARCHITECTURE.md section 5 for the full rationale.
- No real customer-facing channel exists yet — the AI Sales Agent is
  reachable only from inside the dashboard (`channel = 'website'`,
  staff plays the customer role) as a way to build and test the
  conversation engine itself. WhatsApp/web-widget/etc. connecting real
  customers to this same engine is Phase 5, not started.
- The Sales Agent reuses the same simple in-process (not multi-instance-
  safe) rate limiter as the AI Assistant from Phase 3, just on a separate
  per-user budget key.
- Owner-notification rules are intentionally a small fixed set of
  transition types (hot lead, human handover, pause, complaint) rather
  than a configurable rules engine — easy to extend later, deliberately
  not over-built now.
- No approval/confirmation workflow UI exists for the write tools yet —
  each write is validated, scoped, and audited, but there's no
  "review before it happens" step. Not required by this phase's spec
  (every write tool is deliberately low-risk: create/update a lead or
  customer, create a task, log an event, change conversation mode — never
  anything from the explicitly excluded high-risk list).

**What we need from you before Phase 5:** run the new
`0007_ai_sales_agent.sql` migration (see above) if you haven't already.
Everything else in this app, including Phase 4, works without any further
setup beyond what Phase 3 already needed.

## Phase 5 — WhatsApp ⬜

Build: official WhatsApp Business Platform integration — inbound/outbound
messages, webhooks, conversation history, human takeover, owner
notifications.
**Requires:** a Meta Business account and WhatsApp Business Platform app
(see SETUP.md section 7). Uses only the official Cloud API.
**Acceptance:** A real/approved test WhatsApp conversation enters the
system, gets an AI reply, and creates/updates a CRM lead.

## Phase 6 — Follow-up Automation (n8n) ⬜

Build: configurable follow-up sequences, scheduling, reminders, stop
conditions, owner notifications, orchestrated via n8n.
**Requires:** an n8n instance (self-hosted or n8n Cloud).
**Acceptance:** A test lead automatically receives the correct follow-up
at the configured time.

## Phase 7 — Content Factory ⬜

Build: content generator, templates, brand system, content calendar,
approval workflow, poster/creative brief generation.
**Acceptance:** Owner can request a job advertisement and get ready-to-
review content, generated only from verified business data.

## Phase 8 — Social Publishing ⬜

Build: OAuth/token management and publishing adapters for Facebook,
Instagram, TikTok, and LinkedIn (whichever are practical/verified first).
**Requires:** developer apps on each platform (see SETUP.md section 7).
**Acceptance:** Owner approves content and the system publishes where
account/API permissions allow — otherwise it's clearly marked "Ready to
Publish," never falsely marked as published.

## Phase 9 — Analytics ⬜

Build: lead, sales pipeline, content, and marketing-attribution analytics;
AI usage/cost reporting.
**Acceptance:** Owner can see measurable business activity in the
dashboard, built only from real recorded data.

## Phase 10 — Advanced Automation ⬜

Build: automatic job expiry sweeps, automated daily reports, advanced
follow-ups, document reminders, payment event handling, business insights,
the natural-language AI Command Centre.

## Phase 11 — Grandvic Motors ⬜

Only after Tours & Travel is stable. Build: vehicle inventory, enquiries,
imports, financing, insurance, sales pipeline, marketing — reusing the same
Grandvic AI core and the `businesses`/`business_modules` tables already
designed for this.

---

## How to read this file

- A phase's "Acceptance" line is the bar for calling it done — matches the
  master build specification exactly.
- "Requires" lines are the only external accounts/credentials you need to
  gather before that phase starts; nothing is requested before it's
  actually needed.
- This file is updated at the end of every phase, alongside CHANGELOG.md.

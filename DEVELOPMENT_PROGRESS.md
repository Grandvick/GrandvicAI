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
document uploads. Nothing else is blocking — Phase 2 (Jobs Module) is
pure application code against the schema already built in Phase 0.

## Phase 2 — Jobs Module 🔜

Build: job (opportunity) CRUD UI, status transitions (Draft → Pending
Review → Open → Paused/Closed/Expired), automatic expiry enforcement,
document requirements, candidate matching basics.
**Acceptance:** Owner can create an opportunity, mark it OPEN, and it's
retrievable as active; closing it removes it from active recommendations.

## Phase 3 — AI Core ⬜

Build: AI service layer, tool-calling architecture, knowledge retrieval,
conversation handling, guardrails, `ai_runs` logging.
**Requires:** an OpenAI API key (see SETUP.md section 7).
**Acceptance:** AI can answer questions about active opportunities using
real database information — never invented data.

## Phase 4 — AI Sales Agent ⬜

Build: qualification flows, lead scoring engine, objection handling,
CRM auto-updates, escalation rules, human takeover.
**Acceptance:** A test customer can move NEW → QUALIFIED → HOT and the
owner receives the appropriate notification.

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

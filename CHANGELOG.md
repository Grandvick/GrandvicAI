# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — Phase 1: CRM + Database

### Added
- **Customers**: list (search), create, and detail page (editable profile
  + linked leads/tasks/applications/documents) — `src/app/(dashboard)/customers/**`.
- **Leads**: list with a drag-and-drop Kanban pipeline board and a
  filterable table view, create, and a detail page with inline
  stage/temperature/score/assignment editing, notes, and a full activity
  timeline — `src/app/(dashboard)/leads/**`.
- **Tasks**: list with status filter and inline status updates, create
  (optionally linked to a customer or lead) — `src/app/(dashboard)/tasks/**`.
- **Applications**: lightweight status tracking, optionally linked to a
  lead and/or opportunity — `src/app/(dashboard)/applications/**`.
- **Documents**: request, upload (private Supabase Storage bucket),
  status tracking, and short-lived signed-URL viewing —
  `src/app/(dashboard)/documents/**`.
- **Notifications**: Topbar bell (unread badge, dropdown, mark read/mark
  all read) and a `/notifications` page; automatic "🔥 Hot lead"
  notification on the nurture/warm → hot transition.
- Business-logic layer in `src/lib/business/`: `context.ts`
  (current-user + business-scope resolution), `validation.ts` (Zod
  schemas shared by server actions and tests), `customers.ts`,
  `leads.ts`, `lead-events.ts`, `pipeline-stages.ts`, `tasks.ts`,
  `applications.ts`, `documents.ts`, `notifications.ts`, `hot-lead.ts`
  (pure notification-transition rule), `opportunities.ts` (read-only —
  full opportunity management is Phase 2), `staff.ts`, `businesses.ts`,
  `audit.ts` (shared `logActivity()` helper, now called from every
  Phase 1 mutation including customers create/update).
- New migration `supabase/migrations/0002_documents_storage.sql`: private
  `documents` Storage bucket + business-scoped RLS policies (written to
  be safely re-runnable). **Action needed:** run this once in the
  Supabase SQL Editor — see SETUP.md section 3.
- 29 new unit tests: Zod validation schemas, the hot-lead notification
  transition rule, document file validation, pipeline-stage
  fallback/de-duplication logic, and the customer lead-count aggregate
  mapping.
- `zod` and `server-only` added as dependencies; `next.config.ts` now
  sets `serverActions.bodySizeLimit: "10mb"` for document uploads.

### Changed
- Sidebar nav: Leads, Customers, Tasks, Applications, and Documents no
  longer show "Coming in Phase N" — they're live.
- `customers.ts`'s `createCustomer`/`updateCustomer` now write to
  `audit_logs` via `logActivity()`, matching every other Phase 1 mutation
  (previously only tasks/leads/applications/documents did this).

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 29/29 passing (6 test files).
- `npm run build` — succeeds; all Phase 1 routes correctly forced
  dynamic (customers, leads, tasks, applications, documents,
  notifications, and their `/new` and `/[id]` sub-routes).

### Known limitations
- Applications/documents are basic status trackers — full job matching,
  requirement checklists, and expiry enforcement are Phase 2.
- No fine-grained role permissions beyond Owner vs. scoped-staff yet
  (e.g. any staff member can set a document's status to `approved`).
- No pagination on list views yet.
- Customer detail page's lead list is fetched via a full business-wide
  query filtered client-side, not a dedicated filtered query.

## [0.1.0] — Phase 0: Project Foundation

### Added
- Next.js 16 + TypeScript + Tailwind CSS v4 application scaffold.
- Supabase integration: browser/server/service-role clients, session-refresh
  proxy, environment-aware "not configured" fallback UI.
- Full initial database schema (`supabase/migrations/0001_init.sql`):
  roles, businesses, business_modules, profiles, customers, pipeline_stages,
  leads, lead_events, opportunities, applications, document_requirements,
  documents, conversations, conversation_messages, tasks, content,
  content_variants, content_calendar, social_accounts, publishing_jobs,
  payments, notifications, automation_rules, knowledge_items, ai_runs,
  audit_logs, settings — with Row Level Security on every business-scoped
  table.
- Seed data (`supabase/seed.sql`): role catalog, Grandvic Tours & Travel as
  the first business with its three modules, fictional `[DEMO]` customers,
  leads, tasks, a job opportunity, a knowledge base item, and a content
  draft.
- Email/password authentication with automatic Owner bootstrap for the
  first signed-up user.
- Dashboard shell: sidebar navigation (all planned sections), topbar with
  sign-out, "Today's Overview" home page wired to live database counts,
  and "Coming in Phase N" placeholders for unbuilt sections.
- Settings page showing integration status (Supabase/OpenAI/WhatsApp env
  var presence) without overclaiming a tested connection.
- `/api/health` status endpoint.
- Documentation: README.md, SETUP.md, ARCHITECTURE.md,
  DEVELOPMENT_PROGRESS.md, this CHANGELOG.md, `.env.example`.
- Vitest test runner with unit tests for the dashboard overview's
  aggregation and graceful-degradation logic.

### Verified
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- `npm run test` — 2/2 passing.
- `npm run build` — succeeds (all dashboard routes correctly forced
  dynamic since they depend on the live session).
- Production server boots and correctly shows the "Setup required" screen
  when Supabase environment variables are absent.

### Known limitations
- No CRUD UI yet for leads/customers/jobs/etc. (Phase 1/2).
- `src/lib/supabase/types.ts` is a placeholder pending real Supabase CLI
  type generation once a project exists.
- `npm audit`: 2 moderate advisories in vitest's dev-only dependency chain;
  deferred fix to avoid a disruptive major-version bump mid-foundation.

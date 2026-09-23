-- =============================================================================
-- GRANDVIC AI — Phase 5A: WhatsApp channel database foundation
-- =============================================================================
-- Run this AFTER 0001-0007, the same way (Supabase SQL Editor -> New query ->
-- paste -> Run). Safe to re-run.
--
-- SCOPE (Phase 5A ONLY — see the Phase 5 planning doc, section C/N):
-- This migration is schema only. It adds no webhook route, no outbound
-- adapter, no provider abstraction, and connects to nothing at Meta. Its one
-- job is to give the (not-yet-built) webhook layer somewhere safe and
-- idempotent to write to, and to let a WhatsApp conversation be found the
-- same way every other conversation already is.
--
-- WHY THIS MIGRATION EXISTS AT ALL:
-- `conversations.channel` has allowed the value 'whatsapp' since
-- 0006_ai_core.sql — no channel-constraint change is needed or made here.
-- What's actually missing is: (1) a way to detect a duplicate Meta webhook
-- delivery before it creates a second customer/lead/message (Meta documents
-- at-least-once, possibly-duplicate delivery), (2) a way to find-or-create
-- the right `conversations` row for a given WhatsApp phone number without a
-- signed-in user session to key off, and (3) a way to resolve which
-- business a webhook belongs to from Meta's `phone_number_id`, since a
-- webhook request carries no `auth.uid()` for `current_business_id()` to
-- resolve from. Every change below is additive: no existing column is
-- widened destructively, no existing constraint is dropped, no existing RLS
-- policy is touched, and no existing table's existing behavior changes.
-- =============================================================================

do $$
begin
  if to_regclass('public.businesses') is null
     or to_regclass('public.conversations') is null
     or to_regclass('public.conversation_messages') is null
     or to_regprocedure('public.is_owner()') is null
     or to_regprocedure('public.current_business_id()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception
      using message = '0001_init.sql (and 0006_ai_core.sql / 0007_ai_sales_agent.sql) have not '
        || 'fully run against this database yet — run 0001 through 0007 in order first, '
        || 'then re-run this migration. See SETUP.md section 3.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. conversation_messages: idempotency + direction + media columns
-- -----------------------------------------------------------------------------
alter table public.conversation_messages
  add column if not exists external_id text,
  add column if not exists direction text check (direction in ('inbound', 'outbound')),
  add column if not exists media jsonb not null default '{}'::jsonb;

comment on column public.conversation_messages.external_id is
  'The sending channel''s own message id (e.g. Meta''s wamid for WhatsApp) — the message-level idempotency key a future webhook handler checks before inserting, so a Meta webhook retry can never create a duplicate row. NULL for messages that never came from an external channel (dashboard/website today) — never backfilled for those.';
comment on column public.conversation_messages.direction is
  'inbound = from the customer, outbound = from the business (ai or staff). Nullable so every historical Phase 0-4 row stays valid without a migration-time guess; backfilled below only from sender_type, which already unambiguously implies it.';
comment on column public.conversation_messages.media is
  'Generic media metadata for a channel-delivered attachment (image, voice note, document) — e.g. {"type","storagePath","mimeType","caption","waMediaId"}. Deliberately one jsonb column, not a column per media type, matching the existing convention (conversations.qualification). Empty object for every non-media message.';

-- Backfill direction for existing rows from the already-unambiguous
-- sender_type — idempotent (only ever touches rows still NULL), and purely
-- additive: it does not change what any existing row means, only names it.
update public.conversation_messages
set direction = case when sender_type = 'customer' then 'inbound' else 'outbound' end
where direction is null;

-- Message-level idempotency key. Partial (WHERE external_id IS NOT NULL) so
-- every existing row — and every future dashboard/website row, which never
-- sets external_id — is completely unaffected; Postgres never treats two
-- NULLs as a duplicate in a unique index, so this only ever rejects a
-- genuine repeat external_id.
create unique index if not exists conversation_messages_external_id_idx
  on public.conversation_messages(external_id)
  where external_id is not null;

-- -----------------------------------------------------------------------------
-- 2. conversations: stable external thread identity
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists channel_thread_key text;

comment on column public.conversations.channel_thread_key is
  'The stable external identity of this thread on its channel — the normalized phone number for WhatsApp. Lets a webhook find-or-create the right conversation atomically via (business_id, channel, channel_thread_key), the same role customers.phone plays for customer identity but scoped to the thread rather than the person. NULL for dashboard/website conversations, which have no such external key.';

-- Partial for the same reason as conversation_messages_external_id_idx above:
-- dashboard/website conversations never set this and must never collide with
-- each other or be blocked from being created.
create unique index if not exists conversations_business_channel_thread_key_idx
  on public.conversations(business_id, channel, channel_thread_key)
  where channel_thread_key is not null;

-- Explicitly NOT changed: the conversations_channel_check constraint.
-- 'whatsapp' has been a legal channel value since 0006_ai_core.sql.

-- -----------------------------------------------------------------------------
-- 3. whatsapp_business_accounts: phone_number_id -> business_id
-- -----------------------------------------------------------------------------
-- Resolves an inbound webhook's phone_number_id to a business_id. Required
-- because a webhook request has no auth.uid() for current_business_id() to
-- resolve from — this table is the explicit, application-code-checked
-- mapping a future webhook/service-context path uses instead (see the Phase
-- 5 plan, section B/I). One row per connected WhatsApp number; supports the
-- existing multi-business design (public.businesses) without hard-coding
-- Grandvic's own number anywhere in code.
create table if not exists public.whatsapp_business_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone_number_id text not null,
  waba_id text,
  display_phone_number text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id),
  unique (phone_number_id)
);

comment on table public.whatsapp_business_accounts is
  'Phase 5 — maps a Meta WhatsApp phone_number_id to a Grandvic AI business_id. One WhatsApp number per business today; the unique(business_id) constraint reflects that, not a platform limit. No access token is stored here (see comment on public.settings) — WHATSAPP_ACCESS_TOKEN stays in environment variables.';

-- `create trigger` has no IF NOT EXISTS in Postgres — guarded the same way
-- every `create policy` below already is, so a re-run never errors.
drop trigger if exists whatsapp_business_accounts_set_updated_at on public.whatsapp_business_accounts;
create trigger whatsapp_business_accounts_set_updated_at
  before update on public.whatsapp_business_accounts
  for each row execute function public.set_updated_at();

alter table public.whatsapp_business_accounts enable row level security;

drop policy if exists whatsapp_business_accounts_rw on public.whatsapp_business_accounts;
create policy whatsapp_business_accounts_rw on public.whatsapp_business_accounts
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

-- -----------------------------------------------------------------------------
-- 4. whatsapp_webhook_events: event-level idempotency
-- -----------------------------------------------------------------------------
-- Meta explicitly documents at-least-once, possibly-duplicate webhook
-- delivery. A future webhook handler inserts here (using the service-role
-- key, which bypasses RLS) BEFORE doing anything else; a unique-violation on
-- wa_event_id means "already processed" and the handler stops. No
-- business_id column by design (Phase 5 plan, section C) — the event may
-- need to be recorded before its payload is parsed and phone_number_id is
-- resolved to a business, so this table cannot be business-scoped the way
-- every other table in this schema is.
create table if not exists public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  wa_event_id text not null unique,
  payload jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_webhook_events is
  'Phase 5 — one row per Meta webhook event, keyed by wa_event_id, for idempotency against Meta''s documented at-least-once delivery. Written by the service-role context only (no business_id exists yet at insert time) — see the Phase 5 plan, section F. Intentionally has no business-scoped RLS policy; see the RLS block below.';

alter table public.whatsapp_webhook_events enable row level security;

-- Owner-only read, mirroring the spirit of audit_logs (an append-only,
-- system-generated record). Deliberately NO insert/update/delete policy for
-- the `authenticated` role at all: RLS denies by default with no matching
-- policy, so no signed-in user — owner included — can write to this table
-- through the normal app connection. Only the service-role key (which
-- bypasses RLS entirely, by design, the same way it does for every other
-- table in this schema) can insert the webhook handler's rows. This is
-- deliberately NOT a broad "service role can do anything" policy — no such
-- policy is created, because none is needed: service-role access already
-- bypasses RLS at the Postgres level, so adding a policy for it here would
-- only widen what `authenticated` users can do, which is the opposite of
-- what this table needs.
drop policy if exists whatsapp_webhook_events_select_owner on public.whatsapp_webhook_events;
create policy whatsapp_webhook_events_select_owner on public.whatsapp_webhook_events
  for select to authenticated
  using (public.is_owner());

-- -----------------------------------------------------------------------------
-- 5. message_templates: local cache of Meta-approved templates
-- -----------------------------------------------------------------------------
-- Grandvic AI does not approve WhatsApp templates here — Meta does, through
-- its own review process. This table is only a business-scoped, read-mostly
-- local mirror of a template's name/status/preview, populated by syncing
-- against Meta's template list API in a later Phase 5 stage (not this one).
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  meta_template_name text not null,
  meta_template_status text,
  category text,
  language text,
  body_preview text,
  variables jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, meta_template_name, language)
);

comment on table public.message_templates is
  'Phase 5 — local, business-scoped cache of a Meta-approved WhatsApp message template (name/status/preview only). The actual template content and approval live at Meta; this table never grants the AI permission to create or modify a Meta template, only to read which ones are currently approved for sending.';

create index if not exists message_templates_business_id_idx
  on public.message_templates(business_id);

drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

alter table public.message_templates enable row level security;

drop policy if exists message_templates_rw on public.message_templates;
create policy message_templates_rw on public.message_templates
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

-- =============================================================================
-- Done. Nothing above drops a table, drops a column, widens an existing
-- column destructively, or changes an existing RLS policy. Every new column
-- is nullable or safely defaulted; every new table is business-scoped RLS
-- following the exact `business_id = current_business_id()` pattern already
-- used throughout 0001_init.sql, except whatsapp_webhook_events, which is
-- deliberately owner-read-only per section 4's comment above. No webhook
-- route, outbound adapter, provider, or inbox UI is created by this
-- migration — see the Phase 5 planning doc for those later stages.
-- =============================================================================

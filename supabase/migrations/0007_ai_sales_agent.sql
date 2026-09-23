-- =============================================================================
-- GRANDVIC AI — Phase 4: AI Sales Agent, Lead Qualification & Conversation Engine
-- =============================================================================
-- Run this AFTER 0001-0006. Safe to re-run.
--
-- WHY THIS MIGRATION EXISTS AT ALL:
-- Phase 4 builds a channel-agnostic conversation/sales-agent engine on top of
-- the `conversations` table that already exists (0001_init.sql) and already
-- carries `mode` for human takeover (spec section 16). Two real gaps:
--
--   1. `mode` only allowed ('ai', 'human') — there was no value for "AI
--      paused, not replying, not yet handed to a human either" (spec section
--      16's third state). This adds 'paused'.
--   2. Conversation-level structured state (detected intent, matched
--      opportunity, qualification data captured so far, which lead it's
--      linked to) had nowhere to live. Spec section 17 explicitly asks for
--      this to be "preserved separately from raw conversation history"
--      rather than re-derived from the message transcript on every request.
--      These are added as columns directly on `conversations` — NOT a new
--      conversation table (the spec explicitly forbids that) — plus one new
--      companion table, `conversation_events`, which mirrors the exact
--      pattern already established by `lead_events` (0001_init.sql) and
--      `application_events` (0003_jobs_abroad.sql): a per-entity structured
--      timeline table with the same shape and the same RLS pattern. This is
--      the established convention in this codebase for "log what happened
--      to this record over time," not a duplicate of anything.
--
-- No existing table is dropped or renamed. No existing RLS policy is
-- weakened. `leads.temperature` and `leads` itself are NOT changed — the
-- Phase 4 spec's four-value temperature model (HOT/WARM/COLD/NURTURE) is
-- deliberately mapped onto the existing three-value enum
-- ('hot'/'warm'/'nurture') by the application layer (COLD = the low end of
-- NURTURE — see src/lib/ai/qualification/scoring.ts), rather than widening
-- a column that 15+ files in the already-shipped Phase 1 CRM UI depend on
-- (leads pages, pipeline board, badges, forms) — per the explicit
-- instruction not to rebuild or unnecessarily modify existing modules.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. conversations.mode: add 'paused'
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'conversations_mode_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations drop constraint conversations_mode_check;
  end if;

  alter table public.conversations
    add constraint conversations_mode_check
    check (mode in ('ai', 'human', 'paused'));
end $$;

comment on column public.conversations.mode is
  'Human takeover state (spec section 16). ai = the AI Sales Agent responds automatically. human = a staff member has taken over; the AI must not auto-reply. paused = AI replies are paused without an active human handler yet.';

-- -----------------------------------------------------------------------------
-- 2. conversations: structured sales-agent state columns
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists intent text,
  add column if not exists matched_opportunity_id uuid references public.opportunities(id) on delete set null,
  add column if not exists qualification jsonb not null default '{}'::jsonb,
  add column if not exists handover_reason text;

comment on column public.conversations.lead_id is
  'The CRM lead this conversation has been linked to, if any (spec section 5/17). Set by the create_lead / update_conversation_state AI tools, never written directly by the model.';
comment on column public.conversations.intent is
  'Free-text intent key from a documented, extensible set (see src/lib/ai/sales/intents.ts, spec section 9) — not a Postgres enum, so new intents never require a migration.';
comment on column public.conversations.matched_opportunity_id is
  'The job/opportunity currently believed relevant to this conversation. Every write to this column is re-validated against the job''s live effective status (open/paused/closed/expired) — see src/lib/ai/tools/write.ts — never recommended or stored once a job is no longer effectively open (spec section 11, critical).';
comment on column public.conversations.qualification is
  'Structured qualification data captured during the conversation (service interest, destination, travel dates, budget, experience, urgency, preferred contact method, etc. — spec section 3). An allow-listed shape enforced by the update_conversation_state tool''s Zod schema, not arbitrary key/value data from the model.';
comment on column public.conversations.handover_reason is
  'Why this conversation left AI_ACTIVE mode (e.g. "customer requested human", "complaint", "AI unable to answer"). Set alongside mode changes.';

create index if not exists conversations_lead_id_idx on public.conversations(lead_id);
create index if not exists conversations_matched_opportunity_id_idx on public.conversations(matched_opportunity_id);

-- -----------------------------------------------------------------------------
-- 3. conversation_events: structured event timeline (mirrors lead_events /
--    application_events exactly — spec section 20)
-- -----------------------------------------------------------------------------
create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  event_type text not null, -- e.g. 'intent_detected', 'qualification_started', 'lead_created', 'opportunity_matched', 'human_handover', 'ai_resumed', 'follow_up_required'
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

comment on table public.conversation_events is
  'Structured, analyzable timeline of what happened in a conversation (spec section 20/26) — distinct from the flat cross-entity audit_logs table and from the raw conversation_messages transcript. Mirrors lead_events/application_events.';

create index if not exists conversation_events_conversation_id_idx on public.conversation_events(conversation_id);

alter table public.conversation_events enable row level security;

drop policy if exists conversation_events_rw on public.conversation_events;
create policy conversation_events_rw on public.conversation_events
  for all to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_events.conversation_id and c.business_id = public.current_business_id()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_events.conversation_id and c.business_id = public.current_business_id()
    )
  );

-- =============================================================================
-- GRANDVIC AI — Phase 3: AI Core
-- =============================================================================
-- Run this AFTER 0001-0005. Safe to re-run.
--
-- WHY THIS MIGRATION EXISTS AT ALL:
-- Every table the AI Core needs — `ai_runs` (run logging), `audit_logs`
-- (activity), `settings` (business config), `knowledge_items` (structured
-- knowledge retrieval), and `conversations` / `conversation_messages`
-- (chat persistence) — already exists from 0001_init.sql with RLS already
-- enabled and already correctly business-scoped. Phase 3 adds NO new
-- tables and changes NO RLS policy. The one real gap: `conversations.channel`
-- only allowed ('whatsapp', 'website', 'facebook', 'instagram', 'email') —
-- there was no value for a conversation that happened in the dashboard's own
-- AI Command Center (spec section 12: "the design should eventually support
-- dashboard / WhatsApp / website / social conversations" using a channel
-- field). This migration adds 'dashboard' to that allowed list. Everything
-- else below is a defensive, idempotent no-op guard.
-- =============================================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'conversations_channel_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations drop constraint conversations_channel_check;
  end if;

  alter table public.conversations
    add constraint conversations_channel_check
    check (channel in ('whatsapp', 'website', 'facebook', 'instagram', 'email', 'dashboard'));
end $$;

comment on column public.conversations.channel is
  'Which surface this conversation happened on. ''dashboard'' = the AI Command Center (Phase 3); the others arrive with their respective phases (WhatsApp: Phase 5, website/social: Phase 5/8).';

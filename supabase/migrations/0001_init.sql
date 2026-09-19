-- =============================================================================
-- GRANDVIC AI — INITIAL DATABASE SCHEMA (Phase 0 foundation)
-- =============================================================================
-- Design principles (see ARCHITECTURE.md for the full explanation):
--   1. Everything that belongs to a business hangs off `business_id`, so the
--      platform can host multiple businesses (Grandvic Tours & Travel today,
--      Grandvic Motors later) without duplicating the application.
--   2. Every table that stores business data has Row Level Security enabled.
--      The OWNER role can see everything; other roles are scoped to the
--      business(es) they are assigned to. Refine per-role policies further
--      as roles beyond OWNER are actually built (Phase 1+).
--   3. No table here hard-codes Grandvic-specific data (company name, job
--      categories, etc.) — that lives in rows (businesses, business_modules,
--      knowledge_items, settings), seeded by supabase/seed.sql.
--   4. This migration creates STRUCTURE only. Most tables will not have a
--      full CRUD UI until their corresponding phase (see
--      DEVELOPMENT_PROGRESS.md) — building the schema now avoids painful
--      re-modeling later, per the master build spec (section 40).
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- IDENTITY & ACCESS
-- =============================================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, -- e.g. 'owner', 'admin', 'sales_agent', 'recruitment_officer', 'travel_consultant', 'marketing_manager', 'staff', 'read_only'
  name text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb, -- reserved for fine-grained permission flags as roles beyond OWNER are implemented
  created_at timestamptz not null default now()
);

comment on table public.roles is 'Role catalog for role-based access control (spec section 6). Only "owner" is functionally enforced in Phase 0.';

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, -- e.g. 'grandvic-tours-travel', 'grandvic-motors'
  name text not null,
  logo_url text,
  contact_email text,
  contact_phone text,
  address text,
  timezone text not null default 'Africa/Nairobi',
  currency text not null default 'KES',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.businesses is 'A tenant business, e.g. Grandvic Tours & Travel, later Grandvic Motors (spec section 38).';

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.business_modules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null, -- e.g. 'jobs_abroad', 'visa_services', 'tours_safaris', 'vehicle_sales', 'vehicle_imports', 'asset_financing', 'insurance', 'after_sales', 'spare_parts'
  name text not null,
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key)
);

comment on table public.business_modules is 'Sub-areas of a business, e.g. Jobs Abroad / Visa Services / Tours & Safaris under Grandvic Tours & Travel.';

create trigger business_modules_set_updated_at
  before update on public.business_modules
  for each row execute function public.set_updated_at();

-- Profile extends Supabase auth.users with app-level identity/role/business scope.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role_id uuid references public.roles(id),
  business_id uuid references public.businesses(id), -- null for OWNER (sees all businesses); required for scoped staff roles
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per authenticated user, extending auth.users with role + business scope.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-provision a profile whenever a new auth user is created.
-- The very first user to ever sign up becomes OWNER automatically (bootstrap);
-- every subsequent signup defaults to the least-privileged 'staff' role and
-- must be assigned a business + upgraded role by the owner from Settings.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner_role_id uuid;
  v_staff_role_id uuid;
  v_is_first_user boolean;
begin
  select (count(*) = 0) into v_is_first_user from public.profiles;

  select id into v_owner_role_id from public.roles where key = 'owner';
  select id into v_staff_role_id from public.roles where key = 'staff';

  insert into public.profiles (id, full_name, role_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    case when v_is_first_user then v_owner_role_id else v_staff_role_id end
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS helper functions -------------------------------------------------------

create or replace function public.is_owner()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and r.key = 'owner' and p.is_active
  );
$$;

create or replace function public.current_business_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select business_id from public.profiles where id = auth.uid();
$$;

-- =============================================================================
-- CRM: customers, leads, pipeline
-- =============================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  country text,
  profession text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_business_id_idx on public.customers(business_id);
create index customers_phone_idx on public.customers(phone);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  module_id uuid references public.business_modules(id) on delete cascade,
  key text not null, -- e.g. 'new', 'contacted', 'qualified', ...
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, module_id, key)
);

comment on table public.pipeline_stages is 'Configurable sales pipeline stages per business/module (spec section 16).';

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  module_id uuid references public.business_modules(id),
  customer_id uuid not null references public.customers(id) on delete cascade,
  service text, -- free-text description, e.g. "Registered Nurse - Jobs Abroad"
  target_country text,
  source text, -- e.g. 'whatsapp', 'facebook_ad', 'referral'
  stage text not null default 'new', -- soft reference to pipeline_stages.key
  score int not null default 0,
  temperature text not null default 'nurture' check (temperature in ('hot', 'warm', 'nurture')),
  assigned_to uuid references public.profiles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_business_id_idx on public.leads(business_id);
create index leads_stage_idx on public.leads(stage);
create index leads_temperature_idx on public.leads(temperature);
create index leads_customer_id_idx on public.leads(customer_id);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null, -- e.g. 'stage_changed', 'score_changed', 'note_added', 'assigned'
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index lead_events_lead_id_idx on public.lead_events(lead_id);

-- =============================================================================
-- JOBS ABROAD: opportunities, applications, documents
-- =============================================================================

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  module_id uuid references public.business_modules(id),
  title text not null,
  country text,
  location text,
  employer text,
  industry text,
  positions_count int,
  contract_duration text,
  salary_amount numeric(14, 2),
  salary_currency text,
  accommodation text,
  meals text,
  working_hours text,
  requirements text[] not null default '{}',
  documents_required text[] not null default '{}',
  application_process text,
  fees text,
  opening_date date,
  closing_date date,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'open', 'paused', 'closed', 'expired')),
  source text,
  last_verified_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.opportunities is 'Jobs Abroad opportunities (spec section 11). Only status = open should ever be promoted to customers — enforced in application code, see src/lib/business/opportunities.ts once Phase 2 is built.';

create index opportunities_business_id_idx on public.opportunities(business_id);
create index opportunities_status_idx on public.opportunities(status);
create index opportunities_closing_date_idx on public.opportunities(closing_date);

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'interview', 'accepted', 'rejected', 'withdrawn')),
  submitted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_business_id_idx on public.applications(business_id);
create index applications_status_idx on public.applications(status);

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

create table public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  module_id uuid references public.business_modules(id),
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  document_type text not null, -- e.g. 'passport', 'cv', 'good_conduct_certificate'
  is_mandatory boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  document_type text not null,
  status text not null default 'requested'
    check (status in ('requested', 'uploaded', 'received', 'pending_review', 'approved', 'rejected', 'expired')),
  storage_path text, -- Supabase Storage object path; never store raw files in the DB
  requested_at timestamptz not null default now(),
  uploaded_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.documents is 'Tracks document lifecycle only. Files live in Supabase Storage (private bucket); AI may flag "looks submitted" but a human must set status to approved (spec section 27).';

create index documents_business_id_idx on public.documents(business_id);
create index documents_customer_id_idx on public.documents(customer_id);
create index documents_status_idx on public.documents(status);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- =============================================================================
-- COMMUNICATIONS: conversations, messages
-- =============================================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel text not null default 'whatsapp'
    check (channel in ('whatsapp', 'website', 'facebook', 'instagram', 'email')),
  mode text not null default 'ai' check (mode in ('ai', 'human')),
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  assigned_to uuid references public.profiles(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.conversations is 'One row per customer conversation thread across channels (spec section 54 unified inbox). "mode" implements human takeover (spec section 18).';

create index conversations_business_id_idx on public.conversations(business_id);
create index conversations_customer_id_idx on public.conversations(customer_id);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'ai', 'staff')),
  sender_profile_id uuid references public.profiles(id),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index conversation_messages_conversation_id_idx on public.conversation_messages(conversation_id);

-- =============================================================================
-- TASKS
-- =============================================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  description text,
  owner_id uuid references public.profiles(id),
  due_date timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  related_customer_id uuid references public.customers(id) on delete set null,
  related_lead_id uuid references public.leads(id) on delete set null,
  related_opportunity_id uuid references public.opportunities(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_business_id_idx on public.tasks(business_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_due_date_idx on public.tasks(due_date);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- =============================================================================
-- CONTENT FACTORY & MARKETING
-- =============================================================================

create table public.content (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  module_id uuid references public.business_modules(id),
  type text not null, -- e.g. 'facebook_post', 'instagram_caption', 'tiktok_script', 'whatsapp_status', 'linkedin_post', 'poster_copy'
  title text,
  body text,
  status text not null default 'draft'
    check (status in ('draft', 'ai_generated', 'awaiting_approval', 'approved', 'scheduled', 'published', 'failed', 'archived')),
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_business_id_idx on public.content(business_id);
create index content_status_idx on public.content(status);

create trigger content_set_updated_at
  before update on public.content
  for each row execute function public.set_updated_at();

create table public.content_variants (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content(id) on delete cascade,
  variant_label text not null default 'default',
  body text,
  image_url text,
  created_at timestamptz not null default now()
);

create table public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  content_id uuid not null references public.content(id) on delete cascade,
  platform text, -- e.g. 'facebook', 'instagram', 'tiktok', 'linkedin', 'whatsapp_status'
  scheduled_for timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'ai_generated', 'awaiting_approval', 'approved', 'scheduled', 'published', 'failed', 'archived')),
  published_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_calendar_business_id_idx on public.content_calendar(business_id);
create index content_calendar_scheduled_for_idx on public.content_calendar(scheduled_for);

create trigger content_calendar_set_updated_at
  before update on public.content_calendar
  for each row execute function public.set_updated_at();

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok', 'linkedin')),
  account_name text,
  external_account_id text,
  -- OAuth tokens must be encrypted at rest by the application layer before
  -- being written here (see ARCHITECTURE.md "Secrets handling"). This column
  -- never stores a plaintext token.
  access_token_encrypted text,
  token_expires_at timestamptz,
  is_active boolean not null default true,
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_accounts_business_id_idx on public.social_accounts(business_id);

create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  content_calendar_id uuid not null references public.content_calendar(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'publishing', 'published', 'failed')),
  attempted_at timestamptz,
  result_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index publishing_jobs_content_calendar_id_idx on public.publishing_jobs(content_calendar_id);

-- =============================================================================
-- PAYMENTS
-- =============================================================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  amount numeric(14, 2),
  currency text,
  purpose text, -- e.g. 'application_fee', 'safari_deposit', 'visa_processing'
  provider text, -- payment provider abstraction — never hard-coded into business logic
  external_reference text,
  status text not null default 'not_requested'
    check (status in ('not_requested', 'requested', 'pending', 'paid', 'failed', 'refunded', 'cancelled')),
  requested_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payments is 'A payment is only ever marked paid by a verified provider webhook/confirmation — never by the AI inferring success (spec section 28).';

create index payments_business_id_idx on public.payments(business_id);
create index payments_status_idx on public.payments(status);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  level text not null default 'normal' check (level in ('normal', 'important', 'high_priority', 'critical')),
  channel text not null default 'dashboard' check (channel in ('dashboard', 'whatsapp', 'email', 'voice')),
  title text not null,
  body text,
  related_type text, -- e.g. 'lead', 'application', 'content', 'payment'
  related_id uuid,
  is_read boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_business_id_idx on public.notifications(business_id);
create index notifications_is_read_idx on public.notifications(is_read);

-- =============================================================================
-- AUTOMATION
-- =============================================================================

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  trigger_type text not null, -- e.g. 'lead_stage_changed', 'schedule', 'job_expiring'
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null, -- e.g. 'send_followup', 'notify_owner', 'close_job'
  action_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index automation_rules_business_id_idx on public.automation_rules(business_id);

create trigger automation_rules_set_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

-- =============================================================================
-- KNOWLEDGE BASE
-- =============================================================================

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  module_id uuid references public.business_modules(id),
  category text not null check (category in (
    'company_info', 'services', 'fees', 'processes', 'faqs', 'job_opportunities',
    'visa_info', 'safari_packages', 'policies', 'contact_info', 'terms',
    'sales_scripts', 'objection_handling', 'marketing_guidelines'
  )),
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.knowledge_items is 'Structured business knowledge the AI retrieves from — never one giant system prompt (spec section 10).';

create index knowledge_items_business_id_idx on public.knowledge_items(business_id);
create index knowledge_items_category_idx on public.knowledge_items(category);

create trigger knowledge_items_set_updated_at
  before update on public.knowledge_items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- AI OBSERVABILITY
-- =============================================================================

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  user_id uuid references public.profiles(id),
  run_type text not null, -- e.g. 'chat_reply', 'content_generation', 'lead_scoring', 'command_centre'
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  model text,
  tokens_input int,
  tokens_output int,
  cost_estimate numeric(10, 6),
  latency_ms int,
  status text not null default 'success' check (status in ('success', 'error', 'blocked')),
  error_message text,
  created_at timestamptz not null default now()
);

comment on table public.ai_runs is 'Every AI call is logged here for observability and cost tracking (spec section 44/45). Built starting Phase 3.';

create index ai_runs_business_id_idx on public.ai_runs(business_id);
create index ai_runs_created_at_idx on public.ai_runs(created_at);

-- =============================================================================
-- AUDIT LOG
-- =============================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'ai')),
  actor_id uuid,
  action text not null, -- e.g. 'lead.stage_changed', 'content.published', 'auth.login'
  object_type text,
  object_id uuid,
  result text not null default 'success' check (result in ('success', 'failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is 'Append-only log of every important system action (spec section 34). Never updated or deleted by the application.';

create index audit_logs_business_id_idx on public.audit_logs(business_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at);

-- =============================================================================
-- SETTINGS
-- =============================================================================

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category text not null, -- e.g. 'business', 'ai', 'notifications', 'marketing', 'sales', 'integrations'
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (business_id, category, key)
);

comment on table public.settings is 'Key/value business configuration, never secrets in plaintext — integration tokens are stored server-side only, referenced here by a non-secret label (spec section 35).';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.roles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_modules enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.opportunities enable row level security;
alter table public.applications enable row level security;
alter table public.document_requirements enable row level security;
alter table public.documents enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.tasks enable row level security;
alter table public.content enable row level security;
alter table public.content_variants enable row level security;
alter table public.content_calendar enable row level security;
alter table public.social_accounts enable row level security;
alter table public.publishing_jobs enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.automation_rules enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.ai_runs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.settings enable row level security;

-- Everyone authenticated can read the role catalog (needed to render role names in Settings).
create policy roles_select_authenticated on public.roles
  for select to authenticated using (true);

-- Profiles: a user can always see/update their own profile; the owner can see/manage every profile.
create policy profiles_select_self_or_owner on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_owner());

create policy profiles_update_self_or_owner on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_owner());

-- Businesses: owner sees/manages all; scoped staff see only their assigned business.
create policy businesses_select on public.businesses
  for select to authenticated
  using (public.is_owner() or id = public.current_business_id());

create policy businesses_all_owner on public.businesses
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Generic pattern for every business-scoped table below: owner sees/manages
-- everything; scoped staff are limited to rows in their own business.
-- (Written per-table because Postgres RLS policies cannot be parameterized
-- across tables.)

create policy business_modules_rw on public.business_modules
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy customers_rw on public.customers
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy pipeline_stages_rw on public.pipeline_stages
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy leads_rw on public.leads
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy lead_events_rw on public.lead_events
  for all to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.leads l
      where l.id = lead_events.lead_id and l.business_id = public.current_business_id()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.leads l
      where l.id = lead_events.lead_id and l.business_id = public.current_business_id()
    )
  );

create policy opportunities_rw on public.opportunities
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy applications_rw on public.applications
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy document_requirements_rw on public.document_requirements
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy documents_rw on public.documents
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy conversations_rw on public.conversations
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy conversation_messages_rw on public.conversation_messages
  for all to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id and c.business_id = public.current_business_id()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id and c.business_id = public.current_business_id()
    )
  );

create policy tasks_rw on public.tasks
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy content_rw on public.content
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy content_variants_rw on public.content_variants
  for all to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.content c
      where c.id = content_variants.content_id and c.business_id = public.current_business_id()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.content c
      where c.id = content_variants.content_id and c.business_id = public.current_business_id()
    )
  );

create policy content_calendar_rw on public.content_calendar
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy social_accounts_rw on public.social_accounts
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy publishing_jobs_rw on public.publishing_jobs
  for all to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.content_calendar cc
      where cc.id = publishing_jobs.content_calendar_id and cc.business_id = public.current_business_id()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.content_calendar cc
      where cc.id = publishing_jobs.content_calendar_id and cc.business_id = public.current_business_id()
    )
  );

create policy payments_rw on public.payments
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy notifications_rw on public.notifications
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy automation_rules_rw on public.automation_rules
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy knowledge_items_rw on public.knowledge_items
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy ai_runs_rw on public.ai_runs
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.is_owner() or business_id = public.current_business_id());

-- Audit logs are append-only from the app's perspective: no update/delete policy
-- is defined, so only the service-role key (which bypasses RLS) can insert on
-- behalf of the system; authenticated users can insert their own user-actor rows.
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.is_owner() or business_id = public.current_business_id());

create policy settings_rw on public.settings
  for all to authenticated
  using (public.is_owner() or business_id = public.current_business_id())
  with check (public.is_owner() or business_id = public.current_business_id());

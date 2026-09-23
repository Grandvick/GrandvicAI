-- =============================================================================
-- GRANDVIC AI — Phase 2: Jobs Abroad Recruitment & Opportunity Management
-- =============================================================================
-- Run this AFTER 0001_init.sql and 0002_documents_storage.sql, the same way
-- (Supabase SQL Editor -> New query -> paste -> Run).
--
-- Design decision (spec section 20 — "check whether existing tables can be
-- safely extended before creating new ones"): the Phase 0 schema already
-- shipped an `opportunities` table (jobs abroad postings), an `applications`
-- table with an `opportunity_id` foreign key, a `document_requirements`
-- table keyed by `opportunity_id`, and a `documents` table with an
-- `application_id` foreign key. That is exactly the shape Phase 2's spec
-- asks for (job -> applications -> candidate -> documents). Rather than
-- create a parallel `job_opportunities` table (pure duplication), this
-- migration EXTENDS `opportunities` in place with the full Jobs Abroad field
-- set from spec section 3, and extends `applications` with the recruitment
-- pipeline from spec section 9. The one genuinely new table is
-- `application_events`, which mirrors the already-proven `lead_events`
-- pattern to give each application its own activity timeline (spec section
-- 11), distinct from the flat cross-entity `audit_logs`.
--
-- Confirmed via `grep` across src/ before writing this migration: none of
-- `opportunities.location`, `opportunities.industry`,
-- `opportunities.positions_count`, `opportunities.documents_required`, or
-- `opportunities.closing_date` are referenced anywhere in application code
-- (Phase 1 only ever selected `id, title, status, country`) — so renaming/
-- restructuring them here is safe for the codebase. It is NOT necessarily
-- safe for data already sitting in a live database, so this migration
-- migrates that data first (see step 2) rather than silently dropping it.
--
-- This migration is NOT safely re-runnable in full the way 0002 is (some
-- steps are one-time renames/data-migrations that would error or double-
-- apply on a second run). If you need to re-run part of it, read the
-- comments on each numbered step first. Every step is wrapped so a genuine
-- re-run after a partial failure skips work that already happened.
-- =============================================================================

do $$
begin
  if to_regclass('public.opportunities') is null
     or to_regclass('public.applications') is null
     or to_regclass('public.document_requirements') is null
     or to_regclass('public.documents') is null
     or to_regprocedure('public.is_owner()') is null
     or to_regprocedure('public.current_business_id()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception
      using message = '0001_init.sql has not fully run against this database yet — '
        || 'run it (and 0002_documents_storage.sql) first, then re-run this migration. '
        || 'See SETUP.md section 3.';
  end if;
end $$;

-- =============================================================================
-- 1. opportunities -> full Jobs Abroad field set
-- =============================================================================

-- 1a. Rename columns whose old names were vague/inconsistent with the rest
--     of the app's naming (safe: confirmed unused in src/ above). Guarded so
--     this is safe to re-run if step 1 partially applied.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'opportunities' and column_name = 'location') then
    alter table public.opportunities rename column location to city;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'opportunities' and column_name = 'industry') then
    alter table public.opportunities rename column industry to category;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'opportunities' and column_name = 'positions_count') then
    alter table public.opportunities rename column positions_count to num_vacancies;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'opportunities' and column_name = 'closing_date') then
    alter table public.opportunities rename column closing_date to application_deadline;
  end if;
end $$;

alter index if exists public.opportunities_closing_date_idx
  rename to opportunities_application_deadline_idx;

-- 1b. New structured fields (spec section 3). All nullable/defaulted so this
--     never fails on existing rows.
alter table public.opportunities
  add column if not exists recruiter_name text,
  add column if not exists employment_type text,
  add column if not exists salary_period text,
  add column if not exists accommodation_provided boolean not null default false,
  add column if not exists meals_provided boolean not null default false,
  add column if not exists transport_provided boolean not null default false,
  add column if not exists airfare_provided boolean not null default false,
  add column if not exists visa_work_permit_support boolean not null default false,
  add column if not exists education_requirement text,
  add column if not exists experience_requirement text,
  add column if not exists license_requirement text,
  add column if not exists language_requirement text,
  add column if not exists min_age int,
  add column if not exists max_age int,
  add column if not exists gender_requirement text,
  add column if not exists passport_required boolean not null default true,
  add column if not exists medical_requirement text,
  add column if not exists job_description text,
  add column if not exists responsibilities text,
  add column if not exists candidate_requirements text,
  add column if not exists benefits text,
  add column if not exists recruiter_reference text,
  add column if not exists expiry_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists closed_at timestamptz;

-- Renamed for accuracy: this always held free-text instructions, not fees.
comment on column public.opportunities.application_process is
  'Application instructions shown to staff/candidates (spec section 3 "application instructions").';

-- Check constraints (guarded — `add constraint` has no `if not exists`).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_employment_type_check'
  ) then
    alter table public.opportunities add constraint opportunities_employment_type_check
      check (employment_type is null or employment_type in
        ('full_time', 'part_time', 'contract', 'temporary', 'seasonal', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_salary_period_check'
  ) then
    alter table public.opportunities add constraint opportunities_salary_period_check
      check (salary_period is null or salary_period in ('hourly', 'daily', 'weekly', 'monthly', 'yearly'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_gender_requirement_check'
  ) then
    alter table public.opportunities add constraint opportunities_gender_requirement_check
      check (gender_requirement is null or gender_requirement in ('any', 'male', 'female'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_age_range_check'
  ) then
    alter table public.opportunities add constraint opportunities_age_range_check
      check (
        (min_age is null or min_age >= 0)
        and (max_age is null or max_age >= 0)
        and (min_age is null or max_age is null or min_age <= max_age)
      );
  end if;
end $$;

-- 1c. `documents_required text[]` predates the proper `document_requirements`
--     table (already present since 0001_init.sql) and duplicates what that
--     table now does with a real UI on top (spec section 10 — "do not hard-
--     code documents"; section 20 — "avoid unnecessary duplication"). Before
--     dropping it, migrate any existing values into document_requirements so
--     nothing already-set by an owner is silently lost. Guarded by a column-
--     existence check so re-running this migration after the column has
--     already been dropped is a safe no-op instead of an error.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'opportunities' and column_name = 'documents_required') then
    insert into public.document_requirements (business_id, module_id, opportunity_id, document_type, is_mandatory)
    select o.business_id, o.module_id, o.id, doc_type, true
    from public.opportunities o, unnest(o.documents_required) as doc_type
    where o.documents_required is not null
      and cardinality(o.documents_required) > 0
      and not exists (
        select 1 from public.document_requirements dr
        where dr.opportunity_id = o.id and dr.document_type = doc_type
      );

    alter table public.opportunities drop column documents_required;
  end if;
end $$;

-- 1d. Indexes (spec section 20). `application_deadline`/`status`/
--     `business_id` already existed under their old names (renamed above);
--     these are the genuinely new ones.
create index if not exists opportunities_country_idx on public.opportunities(country);
create index if not exists opportunities_category_idx on public.opportunities(category);
create index if not exists opportunities_expiry_at_idx on public.opportunities(expiry_at);

comment on table public.opportunities is
  'Jobs Abroad opportunities (spec section 11, extended Phase 2 section 3). '
  'Only status = open (and not past expiry_at) should ever be promoted to '
  'customers by future marketing/recommendation systems — enforced in '
  'application code, see src/lib/business/jobs.ts (isJobEffectivelyOpen).';

-- =============================================================================
-- 2. applications -> full recruitment pipeline (spec section 9)
-- =============================================================================

alter table public.applications
  add column if not exists rejection_reason text;

-- 2a. Drop the OLD check constraint first — it only allows the Phase 1
--     status values, so remapping a row to a Phase 2 value (next step)
--     would otherwise fail against it before the new constraint is even
--     added.
alter table public.applications drop constraint if exists applications_status_check;

-- 2b. Remap existing status values to their nearest pipeline equivalent
--     BEFORE adding the new check constraint, so no historical row is ever
--     left violating it or silently reset (spec: "do not destroy historical
--     status information"). Safe to re-run: every mapped value is also a
--     valid target for the new constraint, so a second pass is a no-op.
update public.applications set status = 'new' where status = 'draft';
update public.applications set status = 'submitted_to_recruiter' where status = 'submitted';
update public.applications set status = 'screening' where status = 'under_review';
update public.applications set status = 'interview_scheduled' where status = 'interview';
update public.applications set status = 'selected' where status = 'accepted';
-- 'rejected' and 'withdrawn' already exist unchanged in the new pipeline.

alter table public.applications add constraint applications_status_check
  check (status in (
    'new', 'screening', 'documents_pending', 'documents_complete', 'shortlisted',
    'submitted_to_recruiter', 'interview_scheduled', 'interview_completed',
    'selected', 'offer_received', 'visa_processing', 'deployment_pending',
    'placed', 'rejected', 'withdrawn'
  ));
alter table public.applications alter column status set default 'new';

comment on column public.applications.status is
  'Recruitment pipeline stage (spec section 9). A single status field is the '
  'source of truth — screening/submission/interview/placement are stages in '
  'this one pipeline, not separate parallel status columns, to avoid the '
  'duplication spec section 20 warns against.';

create index if not exists applications_opportunity_id_idx on public.applications(opportunity_id);
create index if not exists applications_customer_id_idx on public.applications(customer_id);

-- =============================================================================
-- 3. application_events (mirrors lead_events — spec section 11 activity history)
-- =============================================================================

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  event_type text not null, -- e.g. 'created', 'status_changed', 'note_added', 'document_requirement_changed'
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

comment on table public.application_events is
  'Per-application activity timeline (Phase 2, mirrors lead_events). Feeds '
  'the candidate/job detail views'' activity history (spec section 11).';

create index if not exists application_events_application_id_idx
  on public.application_events(application_id);

alter table public.application_events enable row level security;

drop policy if exists application_events_rw on public.application_events;
create policy application_events_rw on public.application_events
  for all to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.applications a
      where a.id = application_events.application_id and a.business_id = public.current_business_id()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.applications a
      where a.id = application_events.application_id and a.business_id = public.current_business_id()
    )
  );

-- =============================================================================
-- 4. document_requirements -> indexes + de-dup safety (spec section 10, 20)
-- =============================================================================

-- De-dup any pre-existing (opportunity_id, document_type) pairs before adding
-- the uniqueness constraint (keeps the earliest row of each duplicate group).
delete from public.document_requirements dr
where exists (
  select 1 from public.document_requirements dr2
  where dr2.opportunity_id = dr.opportunity_id
    and dr2.document_type = dr.document_type
    and dr2.created_at < dr.created_at
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_requirements_unique_type'
  ) then
    alter table public.document_requirements
      add constraint document_requirements_unique_type unique (opportunity_id, document_type);
  end if;
end $$;

create index if not exists document_requirements_business_id_idx
  on public.document_requirements(business_id);
create index if not exists document_requirements_opportunity_id_idx
  on public.document_requirements(opportunity_id);

-- =============================================================================
-- 5. documents -> one more index (spec section 20: "application job_id" join path)
-- =============================================================================

create index if not exists documents_application_id_idx on public.documents(application_id);

-- =============================================================================
-- Done. Nothing above deletes a historical application, candidate, document,
-- or job row — only an unused legacy column (after migrating its data) and
-- duplicate document-requirement rows were removed.
-- =============================================================================

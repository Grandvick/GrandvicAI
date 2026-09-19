-- =============================================================================
-- GRANDVIC AI — Phase 1 addition: private storage bucket for customer documents
-- =============================================================================
-- Run this AFTER 0001_init.sql, the same way (Supabase SQL Editor -> New
-- query -> paste -> Run). It only adds a storage bucket + its RLS policies;
-- it does not touch any existing table.
--
-- Files are stored at: documents/<business_id>/<document_row_id>/<filename>
-- so the same business-scoping pattern used everywhere else in this app
-- (see 0001_init.sql's RLS policies) also protects uploaded files: the
-- first path segment IS the business_id, and the policies below check it
-- against the caller's own business (or grant everything to the Owner),
-- exactly like every other RLS policy in this project.
-- =============================================================================
--
-- Depends on public.is_owner() and public.current_business_id(), both
-- created by 0001_init.sql's "RLS helper functions" section. This preflight
-- check exists because Postgres runs a multi-statement script pasted into
-- the Supabase SQL Editor as a single implicit transaction: if ANY later
-- statement in that long file errors, the whole script — including these
-- two function definitions near its top — rolls back together, even though
-- earlier statements appeared to run. If you see "function
-- public.is_owner() does not exist" here, it means 0001_init.sql did not
-- fully commit against this database. Re-run 0001_init.sql in full (check
-- the SQL Editor output for any red error text), THEN re-run this file.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.is_owner()') is null
     or to_regprocedure('public.current_business_id()') is null then
    raise exception
      using message = 'public.is_owner() / public.current_business_id() not found — '
        || '0001_init.sql has not fully run against this database yet. '
        || 'Re-run supabase/migrations/0001_init.sql in full (watch for any '
        || 'error in the SQL Editor output), then re-run this migration. '
        || 'See SETUP.md section 3.';
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Helper: first path segment of the object name, as the business_id it represents.
create or replace function public.storage_object_business_id(object_name text)
returns uuid
language sql
immutable
as $$
  select (storage.foldername(object_name))[1]::uuid;
$$;

-- `drop policy if exists` before each `create policy` makes this migration
-- safe to re-run (plain `create policy` errors with "already exists" on a
-- second run, unlike the bucket insert above).

drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (public.is_owner() or public.storage_object_business_id(name) = public.current_business_id())
  );

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (public.is_owner() or public.storage_object_business_id(name) = public.current_business_id())
  );

drop policy if exists documents_bucket_update on storage.objects;
create policy documents_bucket_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (public.is_owner() or public.storage_object_business_id(name) = public.current_business_id())
  )
  with check (
    bucket_id = 'documents'
    and (public.is_owner() or public.storage_object_business_id(name) = public.current_business_id())
  );

drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (public.is_owner() or public.storage_object_business_id(name) = public.current_business_id())
  );

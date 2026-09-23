-- =============================================================================
-- GRANDVIC AI — Fix: Owner role bootstrap depended on seed.sql timing
-- =============================================================================
-- Run this AFTER 0001_init.sql, 0002_documents_storage.sql, and
-- 0003_jobs_abroad.sql, the same way (Supabase SQL Editor -> New query ->
-- paste -> Run). Safe to re-run.
--
-- ROOT CAUSE (found by inspecting 0001_init.sql):
--
-- `public.handle_new_user()` (the trigger that fires when a new Supabase
-- Auth user is created) looks up the 'owner' role by querying
-- `public.roles where key = 'owner'`. But `public.roles` is only ever
-- populated by `supabase/seed.sql` — 0001_init.sql creates the empty table,
-- it never seeds the row itself. If the very first Supabase Auth user (the
-- intended Owner) was created BEFORE `seed.sql` had been run, that lookup
-- found no 'owner' row, so the new profile was inserted with `role_id =
-- NULL` instead of the owner role.
--
-- That silently breaks two things this whole app depends on:
--   - `public.is_owner()` joins `profiles.role_id` to `roles.id` — a NULL
--     role_id can never match, so it permanently returns false for that
--     user, even though they were meant to be the bootstrap Owner.
--   - `public.current_business_id()` reads `profiles.business_id`, which is
--     (correctly, by design) NULL for an Owner — Owners aren't pinned to
--     one business, `is_owner()` is what's supposed to grant them access to
--     all of them.
--
-- Every business-scoped RLS policy in this app (see 0001_init.sql) reads
-- `using (is_owner() or business_id = current_business_id())`. With both
-- sides false/NULL, every one of those tables — including `businesses`
-- itself — returns ZERO rows to that user, regardless of whether the
-- seeded Grandvic Tours & Travel business actually exists. That is exactly
-- `resolveBusinessId()`'s "No business exists yet" error
-- (src/lib/business/context.ts): its query isn't wrong, RLS is correctly
-- hiding a row that the caller's profile isn't (yet) entitled to see.
--
-- This is a Phase 0 bug (`handle_new_user()`'s role lookup), not anything
-- introduced by Phase 2, and not a seed-data problem — `seed.sql`'s inserts
-- are all correct and idempotent (`on conflict ... do nothing`), it's just
-- possible to run `seed.sql` *after* the first Auth user already exists,
-- and 0001_init.sql had no defense against that ordering.
--
-- THE FIX (does not touch RLS policies, does not hard-code a business id,
-- does not create or duplicate any business row):
--   1. Make the role catalog required infrastructure, not optional demo
--      data — insert the two roles `handle_new_user()` depends on
--      (`owner`, `staff`) here if missing, so a fresh database is never
--      one step-order mistake away from this bug again.
--   2. Redefine `handle_new_user()` to self-heal: if the 'owner' role
--      doesn't exist yet at the moment a user is created, it creates it
--      inline instead of silently leaving `role_id` NULL.
--   3. One-time repair: if no profile currently holds the owner role, the
--      earliest-created profile (by `created_at`) — i.e. whoever was
--      actually first to sign up — is assigned it. This only ever touches
--      a database that has no working owner yet; a database whose owner
--      bootstrap succeeded originally is left completely untouched.
-- =============================================================================

-- 1. Guarantee the two roles handle_new_user() depends on always exist.
--    (The full catalog still lives in seed.sql — this is deliberately just
--    the two roles the bootstrap trigger itself needs, not a duplicate of
--    seed.sql's fuller role list.)
insert into public.roles (key, name, description) values
  ('owner', 'Owner', 'Full access to every business, module and setting.'),
  ('staff', 'Staff', 'Default least-privileged role for a new team member.')
on conflict (key) do nothing;

-- 2. Self-healing version of the bootstrap trigger.
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
  if v_owner_role_id is null then
    insert into public.roles (key, name, description)
    values ('owner', 'Owner', 'Full access to every business, module and setting.')
    returning id into v_owner_role_id;
  end if;

  select id into v_staff_role_id from public.roles where key = 'staff';
  if v_staff_role_id is null then
    insert into public.roles (key, name, description)
    values ('staff', 'Staff', 'Default least-privileged role for a new team member.')
    returning id into v_staff_role_id;
  end if;

  insert into public.profiles (id, full_name, role_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    case when v_is_first_user then v_owner_role_id else v_staff_role_id end
  );

  return new;
end;
$$;

-- 3. One-time repair for a database whose bootstrap already ran broken.
--    Only acts when NO profile currently has the owner role — a database
--    that already has a working owner is a strict no-op here.
do $$
declare
  v_owner_role_id uuid;
  v_owner_exists boolean;
  v_earliest_profile_id uuid;
begin
  select id into v_owner_role_id from public.roles where key = 'owner';

  select exists (
    select 1 from public.profiles p where p.role_id = v_owner_role_id
  ) into v_owner_exists;

  if not v_owner_exists then
    select id into v_earliest_profile_id
    from public.profiles
    order by created_at asc
    limit 1;

    if v_earliest_profile_id is not null then
      update public.profiles
      set role_id = v_owner_role_id
      where id = v_earliest_profile_id;

      raise notice 'Assigned the Owner role to profile % (earliest signup, previously had no working owner).', v_earliest_profile_id;
    end if;
  end if;
end $$;

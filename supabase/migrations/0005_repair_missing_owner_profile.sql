-- =============================================================================
-- GRANDVIC AI — Repair: missing public.profiles row for a pre-existing
-- Supabase Auth user (the "No business exists yet" symptom, take 2)
-- =============================================================================
-- Run this AFTER 0001_init.sql, 0002_documents_storage.sql,
-- 0003_jobs_abroad.sql, 0004_fix_owner_role_bootstrap.sql, and
-- supabase/seed.sql. Safe to re-run.
--
-- VERIFIED STATE THIS MIGRATION IS RESPONDING TO (via read-only queries run
-- directly in the Supabase SQL Editor, not assumed):
--   - public.roles contains the expected roles, including 'owner'.
--   - public.businesses contains Grandvic Tours & Travel.
--   - public.profiles has ZERO rows.
--   - The affected user CAN log in (a real row exists in auth.users).
--
-- ROOT CAUSE:
-- public.handle_new_user() only ever runs as an `after insert on
-- auth.users` trigger (created by 0001_init.sql). It has no retroactive
-- effect on a row that was inserted before the trigger existed. A
-- combination of (a) a working login, (b) a fully seeded roles/business
-- catalog, and (c) literally zero rows in public.profiles is only possible
-- if the Supabase Auth user account itself was created BEFORE
-- 0001_init.sql was ever run against this project (i.e. before the
-- `on_auth_user_created` trigger and the `profiles` table existed) — so
-- `handle_new_user()` never had a row to react to. This is a different,
-- earlier-stage problem than the one 0004_fix_owner_role_bootstrap.sql
-- solves: 0004 repairs a profile that exists but has a NULL role_id; it
-- was never designed to (and does not) create a profile row that was
-- never inserted at all.
--
-- Is handle_new_user() itself faulty and in need of a further fix? No —
-- as redefined by 0004, it is already correct for every future signup
-- (it self-heals a missing role and always inserts a profile on new
-- Auth-user creation). Nothing about its logic caused this; the ordering
-- of "create your Auth user" vs. "run the migrations" did. No change to
-- handle_new_user() is made here.
--
-- WHAT THIS MIGRATION DOES:
--   1. Looks at auth.users LEFT JOIN public.profiles to find Auth users
--      with no profile row at all ("orphaned" signups).
--   2. If there are zero orphaned users, there is nothing to repair — no-op.
--   3. If there is exactly one, it is unambiguous: that user gets a new
--      public.profiles row, using the EXISTING 'owner' role (found by
--      key, never re-inserted) and is_active = true. Consistent with how
--      0001_init.sql documents the schema ("business_id ... null for
--      OWNER (sees all businesses)"), the Owner's business_id is left
--      NULL — Owner access to Grandvic Tours & Travel (and any future
--      business) is granted by is_owner() in every RLS policy, not by
--      pinning business_id to one row. The business is confirmed to
--      exist (found by slug, never re-inserted, never duplicated) purely
--      as a precondition check.
--   4. If there is more than one orphaned user, it is genuinely ambiguous
--      which one should become Owner. This migration REFUSES to guess:
--      it raises an exception (which rolls the whole transaction back —
--      no partial changes) naming exactly how many are affected and the
--      read-only query to run to identify the correct one.
--
-- THIS MIGRATION DOES NOT:
--   - create a new business (Grandvic Tours & Travel is looked up by slug
--     and reused; if it were somehow missing, this migration stops with
--     an explicit error rather than creating one)
--   - create a duplicate 'owner' role (looked up by key and reused; if it
--     were somehow missing, this migration stops with an explicit error
--     rather than creating one)
--   - guess, hard-code, or invent a user id or email address
--   - weaken, disable, bypass, or alter any RLS policy or grant
--   - touch any table other than public.profiles
--   - overwrite an existing profile row (idempotent: a user who already
--     has a profile is left completely untouched, whatever role it has)
-- =============================================================================

do $$
declare
  v_orphaned_count  int;
  v_target_user_id  uuid;
  v_target_email    text;
  v_owner_role_id   uuid;
  v_business_id     uuid;
  v_full_name       text;
begin
  -- "Orphaned" = a real Auth user with no public.profiles row at all.
  -- In the verified state above (profiles has zero rows), this count
  -- equals the total number of Auth users — but computing it this way
  -- keeps the migration correct and safely re-runnable even after more
  -- users sign up normally in between.
  select count(*) into v_orphaned_count
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null;

  if v_orphaned_count = 0 then
    raise notice 'No orphaned Auth users found (every auth.users row already has a public.profiles row) — nothing to repair.';
    return;
  end if;

  if v_orphaned_count > 1 then
    -- Do not guess. Roll back cleanly and tell the operator exactly what
    -- to check.
    raise exception
      'Refusing to guess: % Auth users have no public.profiles row, so it is ambiguous which one should become Owner. Run this read-only query in the SQL Editor and tell Claude which email is the intended Owner before re-running this migration: select u.id, u.email, u.created_at, u.last_sign_in_at from auth.users u left join public.profiles p on p.id = u.id where p.id is null order by u.created_at asc;',
      v_orphaned_count;
  end if;

  -- Exactly one orphaned user — unambiguous.
  select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
    into v_target_user_id, v_target_email, v_full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null;

  -- Preconditions: reuse existing rows, never create them here.
  select id into v_owner_role_id from public.roles where key = 'owner';
  if v_owner_role_id is null then
    raise exception 'public.roles has no ''owner'' row. Run 0004_fix_owner_role_bootstrap.sql (or supabase/seed.sql) first, then re-run this migration.';
  end if;

  select id into v_business_id from public.businesses where slug = 'grandvic-tours-travel';
  if v_business_id is null then
    raise exception 'public.businesses has no ''grandvic-tours-travel'' row. Run supabase/seed.sql first, then re-run this migration.';
  end if;

  insert into public.profiles (id, full_name, role_id, business_id, is_active)
  values (
    v_target_user_id,
    v_full_name,
    v_owner_role_id,
    null,   -- Owner is intentionally not pinned to one business; see comment block above.
    true
  );

  raise notice 'Created Owner profile for Auth user % (%).', v_target_user_id, v_target_email;
end $$;

-- Verification — shows every profile currently holding the Owner role,
-- confirming role, active status, and (for context only) that
-- Grandvic Tours & Travel exists as a business. business_id/business_name
-- being NULL here is EXPECTED for an Owner (see comment block above) — it
-- does not mean the Owner is unlinked from the business; is_owner() is
-- what grants an Owner visibility into every business, regardless of this
-- column. Safe to re-run standalone at any time.
select
  p.id as profile_id,
  u.email,
  r.key as role_key,
  p.is_active,
  p.business_id,
  b.name as pinned_business_name,
  (select name from public.businesses order by created_at asc limit 1) as first_business_name
from public.profiles p
join public.roles r on r.id = p.role_id
left join auth.users u on u.id = p.id
left join public.businesses b on b.id = p.business_id
where r.key = 'owner';

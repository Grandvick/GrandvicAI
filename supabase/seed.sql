-- =============================================================================
-- GRANDVIC AI — SEED DATA
-- =============================================================================
-- Run this AFTER 0001_init.sql. It seeds:
--   1. The role catalog (required — the app expects these keys to exist).
--   2. Grandvic Tours & Travel as the first tenant business + its 3 modules.
--   3. Safe, clearly-labeled FICTIONAL demo data so the dashboard has
--      something to show before real customers exist (spec section 51).
--
-- IMPORTANT: every person, phone number, job and conversation below is
-- invented for demonstration purposes only. Do not use real passports, IDs,
-- medical records or other sensitive documents in test data, ever.
-- =============================================================================

-- 1. Roles ---------------------------------------------------------------

insert into public.roles (key, name, description) values
  ('owner', 'Owner', 'Full access to every business, module and setting.'),
  ('admin', 'Admin', 'Broad access within assigned business(es).'),
  ('sales_agent', 'Sales Agent', 'Manages leads, customers and the sales pipeline.'),
  ('recruitment_officer', 'Recruitment Officer', 'Manages jobs abroad opportunities and applications.'),
  ('travel_consultant', 'Travel Consultant', 'Manages tours, safaris and visa service enquiries.'),
  ('marketing_manager', 'Marketing Manager', 'Manages content, the content calendar and publishing.'),
  ('staff', 'Staff', 'Default least-privileged role for a new team member.'),
  ('read_only', 'Read Only', 'View-only access, no edits.')
on conflict (key) do nothing;

-- 2. Business + modules ---------------------------------------------------

insert into public.businesses (id, slug, name, contact_email, contact_phone, timezone, currency)
values (
  '00000000-0000-0000-0000-000000000001',
  'grandvic-tours-travel',
  'Grandvic Tours & Travel',
  'info@example.com',      -- DEMO placeholder — replace in Settings once live
  '+254700000000',          -- DEMO placeholder — replace in Settings once live
  'Africa/Nairobi',
  'KES'
)
on conflict (id) do nothing;

insert into public.business_modules (business_id, key, name) values
  ('00000000-0000-0000-0000-000000000001', 'jobs_abroad', 'Jobs Abroad / International Recruitment'),
  ('00000000-0000-0000-0000-000000000001', 'visa_services', 'Visa Services'),
  ('00000000-0000-0000-0000-000000000001', 'tours_safaris', 'Tours & Travel / Safaris')
on conflict (business_id, key) do nothing;

-- Default recruitment pipeline (spec section 16), attached to Jobs Abroad.
insert into public.pipeline_stages (business_id, module_id, key, label, sort_order)
select
  '00000000-0000-0000-0000-000000000001',
  m.id,
  stage.key,
  stage.label,
  stage.sort_order
from public.business_modules m
cross join (values
  ('new', 'New', 1),
  ('contacted', 'Contacted', 2),
  ('qualified', 'Qualified', 3),
  ('assessment', 'Assessment', 4),
  ('payment', 'Payment', 5),
  ('documents', 'Documents', 6),
  ('application', 'Application', 7),
  ('submitted', 'Submitted', 8),
  ('interview', 'Interview', 9),
  ('completed', 'Completed / Closed', 10)
) as stage(key, label, sort_order)
where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (business_id, module_id, key) do nothing;

-- 3. Demo opportunity (FICTIONAL) ------------------------------------------

insert into public.opportunities (
  id, business_id, module_id, title, country, location, employer, industry,
  positions_count, contract_duration, salary_amount, salary_currency,
  accommodation, meals, working_hours, requirements, documents_required,
  application_process, fees, opening_date, closing_date, status, source,
  last_verified_at, notes
)
select
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  m.id,
  '[DEMO] Registered Nurse — Luxembourg',
  'Luxembourg',
  'Luxembourg City',
  '[DEMO] Sample Healthcare Recruiter Ltd',
  'Healthcare',
  5,
  '2 years, renewable',
  2400,
  'EUR',
  'Provided',
  'Not included',
  '40 hours/week',
  array['Registered Nurse qualification', 'Minimum 2 years experience', 'Valid passport'],
  array['passport', 'cv', 'academic_certificates', 'good_conduct_certificate'],
  'Submit CV and certificates, pass assessment interview, employer confirms offer.',
  'Processing fee applies — see current fee schedule in Settings before quoting a customer.',
  current_date - interval '10 days',
  current_date + interval '20 days',
  'open',
  'demo_seed',
  now(),
  'DEMO DATA — replace or delete before going live. Fees and salary are illustrative only.'
from public.business_modules m
where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (id) do nothing;

-- 4. Demo customers + leads (FICTIONAL) -------------------------------------

insert into public.customers (id, business_id, full_name, phone, email, country, profession, notes)
values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001',
   '[DEMO] Jane Wanjiru', '+254711000001', 'jane.demo@example.com', 'Kenya', 'Registered Nurse',
   'DEMO customer — safe to delete.'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001',
   '[DEMO] Peter Otieno', '+254711000002', 'peter.demo@example.com', 'Kenya', 'Physiotherapist',
   'DEMO customer — safe to delete.'),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001',
   '[DEMO] Amina Hassan', '+254711000003', 'amina.demo@example.com', 'Kenya', 'Safari enquiry',
   'DEMO customer — safe to delete.')
on conflict (id) do nothing;

insert into public.leads (id, business_id, module_id, customer_id, service, target_country, source, stage, score, temperature)
select
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000001',
  m.id, '00000000-0000-0000-0000-000000000201',
  '[DEMO] Jobs Abroad — Registered Nurse', 'Luxembourg', 'whatsapp', 'documents', 91, 'hot'
from public.business_modules m where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (id) do nothing;

insert into public.leads (id, business_id, module_id, customer_id, service, target_country, source, stage, score, temperature)
select
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000001',
  m.id, '00000000-0000-0000-0000-000000000202',
  '[DEMO] Jobs Abroad — Physiotherapist', 'Somalia', 'facebook_ad', 'contacted', 48, 'warm'
from public.business_modules m where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (id) do nothing;

insert into public.leads (id, business_id, module_id, customer_id, service, target_country, source, stage, score, temperature)
select
  '00000000-0000-0000-0000-000000000303',
  '00000000-0000-0000-0000-000000000001',
  m.id, '00000000-0000-0000-0000-000000000203',
  '[DEMO] Safari enquiry — Maasai Mara', null, 'website', 'new', 12, 'nurture'
from public.business_modules m where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'tours_safaris'
on conflict (id) do nothing;

-- 5. Demo tasks (FICTIONAL) --------------------------------------------------

insert into public.tasks (business_id, title, description, priority, status, due_date, related_lead_id)
values
  ('00000000-0000-0000-0000-000000000001', '[DEMO] Call Jane Wanjiru about Luxembourg documents',
   'Confirm Good Conduct Certificate has been submitted.', 'high', 'pending', now() + interval '1 day',
   '00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000001', '[DEMO] Follow up with Peter Otieno',
   'He said he would "think about it" — day 2 follow-up.', 'medium', 'pending', now() + interval '2 days',
   '00000000-0000-0000-0000-000000000302');

-- 6. Demo knowledge base item (FICTIONAL / illustrative) ---------------------

insert into public.knowledge_items (business_id, category, title, content, tags)
values (
  '00000000-0000-0000-0000-000000000001',
  'faqs',
  '[DEMO] What documents do I need for Jobs Abroad applications?',
  'Typical documents requested include a valid passport, CV, academic certificates, '
  || 'a Good Conduct Certificate, and passport photos. Exact requirements vary by '
  || 'opportunity — always confirm against the specific opportunity record before '
  || 'telling a customer what is required.',
  array['jobs_abroad', 'documents', 'demo']
);

-- 7. Demo content (FICTIONAL) -------------------------------------------------

insert into public.content (business_id, module_id, type, title, body, status)
select
  '00000000-0000-0000-0000-000000000001', m.id, 'facebook_post',
  '[DEMO] Registered Nurse opportunity — Luxembourg',
  'Sample post copy: "Registered nurses — an international opportunity in Luxembourg '
  || 'is now open for applications. DM us to check your eligibility." '
  || '(DEMO content — review before ever publishing.)',
  'awaiting_approval'
from public.business_modules m where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad';

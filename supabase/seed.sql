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

-- 3. Demo job opportunities (FICTIONAL) --------------------------------------
-- Phase 2 fields: employer/recruiter, employment terms, benefit flags,
-- structured requirements, and expiry_at (the automatic-expiry field —
-- application_deadline is the candidate-facing deadline, expiry_at is the
-- harder system cutoff; see src/lib/business/jobs.ts).

insert into public.opportunities (
  id, business_id, module_id, title, country, city, employer, category,
  recruiter_name, num_vacancies, employment_type, contract_duration,
  salary_amount, salary_currency, salary_period,
  accommodation, accommodation_provided, meals, meals_provided,
  transport_provided, airfare_provided, visa_work_permit_support,
  working_hours, requirements, education_requirement, experience_requirement,
  language_requirement, passport_required, medical_requirement,
  job_description, responsibilities, candidate_requirements, benefits,
  application_process, fees, recruiter_reference,
  opening_date, application_deadline, expiry_at, status, source,
  last_verified_at, notes
)
select
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  m.id,
  '[DEMO] Registered Nurse — Luxembourg',
  'Luxembourg', 'Luxembourg City',
  '[DEMO] Sample Healthcare Group', 'Healthcare',
  '[DEMO] Sample Healthcare Recruiter Ltd',
  5, 'full_time', '2 years, renewable',
  2400, 'EUR', 'monthly',
  'Employer-provided shared apartment near the hospital.', true,
  'Not included', false,
  false, true, true,
  '40 hours/week',
  array['Registered Nurse qualification', 'Minimum 2 years experience', 'Valid passport'],
  'Registered Nurse qualification (or equivalent, recognized in Luxembourg)',
  'Minimum 2 years post-qualification experience',
  'Conversational English; French or German a plus', true,
  'Pre-departure medical clearance required',
  'Provide direct patient care on a general medical ward in a mid-sized Luxembourg hospital.',
  'Patient assessment, medication administration, care planning, handover documentation.',
  'Registered Nurse qualification, 2+ years experience, valid passport, clean good-conduct record.',
  'Housing provided, airfare provided, visa/work permit support, relocation orientation.',
  'Submit CV and certificates, pass assessment interview, employer confirms offer.',
  'Processing fee applies — see current fee schedule in Settings before quoting a customer.',
  'REF-DEMO-101',
  current_date - interval '10 days', current_date + interval '20 days', now() + interval '20 days',
  'open', 'demo_seed',
  now(),
  'DEMO DATA — replace or delete before going live. Fees and salary are illustrative only.'
from public.business_modules m
where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (id) do nothing;

insert into public.opportunities (
  id, business_id, module_id, title, country, city, employer, category,
  num_vacancies, employment_type, contract_duration, salary_amount, salary_currency, salary_period,
  status, source, opening_date, application_deadline, notes
)
select
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000001',
  m.id,
  '[DEMO] Hospitality Supervisor — Qatar',
  'Qatar', 'Doha',
  '[DEMO] Sample Hospitality Group', 'Hospitality',
  2, 'contract', '1 year, renewable', 1600, 'USD', 'monthly',
  'paused', 'demo_seed',
  current_date - interval '40 days', current_date + interval '5 days',
  'DEMO DATA — kept paused on purpose to exercise the Jobs list status filter.'
from public.business_modules m
where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (id) do nothing;

insert into public.document_requirements (business_id, module_id, opportunity_id, document_type, is_mandatory, notes)
select '00000000-0000-0000-0000-000000000001', m.id, '00000000-0000-0000-0000-000000000101', doc.document_type, doc.is_mandatory, null
from public.business_modules m,
  (values
    ('passport', true),
    ('cv', true),
    ('academic_certificates', true),
    ('good_conduct_certificate', true),
    ('medical_certificate', false)
  ) as doc(document_type, is_mandatory)
where m.business_id = '00000000-0000-0000-0000-000000000001' and m.key = 'jobs_abroad'
on conflict (opportunity_id, document_type) do nothing;

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

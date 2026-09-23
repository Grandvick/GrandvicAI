"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from "@/components/ui/field";
import type { FormState } from "./actions";

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
      />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-5">
      <legend className="px-1 text-sm font-semibold text-slate-900">{title}</legend>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export type JobFormValues = {
  title?: string;
  country?: string;
  city?: string;
  employer?: string;
  recruiterName?: string;
  category?: string;
  employmentType?: string;
  contractDuration?: string;
  numVacancies?: number | null;
  salaryAmount?: number | null;
  salaryCurrency?: string;
  salaryPeriod?: string;
  accommodationProvided?: boolean;
  accommodation?: string;
  mealsProvided?: boolean;
  meals?: string;
  transportProvided?: boolean;
  airfareProvided?: boolean;
  visaWorkPermitSupport?: boolean;
  workingHours?: string;
  educationRequirement?: string;
  experienceRequirement?: string;
  licenseRequirement?: string;
  languageRequirement?: string;
  minAge?: number | null;
  maxAge?: number | null;
  genderRequirement?: string;
  passportRequired?: boolean;
  medicalRequirement?: string;
  jobDescription?: string;
  responsibilities?: string;
  candidateRequirements?: string;
  benefits?: string;
  applicationProcess?: string;
  fees?: string;
  recruiterReference?: string;
  openingDate?: string;
  applicationDeadline?: string;
  expiryAt?: string;
  source?: string;
  notes?: string;
};

export function JobForm({
  action,
  defaultValues,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaultValues?: JobFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const v = defaultValues ?? {};

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <Section title="Basic information">
        <div className="sm:col-span-2">
          <Field label="Job title" htmlFor="title" required error={state?.fieldErrors?.title}>
            <TextInput id="title" name="title" defaultValue={v.title} required />
          </Field>
        </div>
        <Field label="Country" htmlFor="country">
          <TextInput id="country" name="country" defaultValue={v.country} />
        </Field>
        <Field label="City" htmlFor="city">
          <TextInput id="city" name="city" defaultValue={v.city} />
        </Field>
        <Field label="Employer" htmlFor="employer">
          <TextInput id="employer" name="employer" defaultValue={v.employer} />
        </Field>
        <Field label="Recruiter / partner name" htmlFor="recruiterName">
          <TextInput id="recruiterName" name="recruiterName" defaultValue={v.recruiterName} />
        </Field>
        <Field label="Category" htmlFor="category" hint="e.g. Healthcare, Hospitality, Construction">
          <TextInput id="category" name="category" defaultValue={v.category} />
        </Field>
        <Field label="Recruiter reference" htmlFor="recruiterReference" hint="Partner's own reference code, if any">
          <TextInput id="recruiterReference" name="recruiterReference" defaultValue={v.recruiterReference} />
        </Field>
      </Section>

      <Section title="Employment">
        <Field label="Employment type" htmlFor="employmentType">
          <Select id="employmentType" name="employmentType" defaultValue={v.employmentType ?? ""}>
            <option value="">Not set</option>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="temporary">Temporary</option>
            <option value="seasonal">Seasonal</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Contract duration" htmlFor="contractDuration" hint="e.g. 2 years, renewable">
          <TextInput id="contractDuration" name="contractDuration" defaultValue={v.contractDuration} />
        </Field>
        <Field label="Number of vacancies" htmlFor="numVacancies">
          <TextInput id="numVacancies" name="numVacancies" type="number" min={0} defaultValue={v.numVacancies ?? ""} />
        </Field>
        <Field label="Working hours" htmlFor="workingHours" hint="e.g. 40 hours/week">
          <TextInput id="workingHours" name="workingHours" defaultValue={v.workingHours} />
        </Field>
        <Field label="Salary amount" htmlFor="salaryAmount">
          <TextInput id="salaryAmount" name="salaryAmount" type="number" min={0} step="0.01" defaultValue={v.salaryAmount ?? ""} />
        </Field>
        <Field label="Salary currency" htmlFor="salaryCurrency" hint="e.g. USD, EUR, AED">
          <TextInput id="salaryCurrency" name="salaryCurrency" defaultValue={v.salaryCurrency} />
        </Field>
        <Field label="Salary period" htmlFor="salaryPeriod">
          <Select id="salaryPeriod" name="salaryPeriod" defaultValue={v.salaryPeriod ?? ""}>
            <option value="">Not set</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </Field>
      </Section>

      <Section title="Requirements">
        <Field label="Education" htmlFor="educationRequirement">
          <TextArea id="educationRequirement" name="educationRequirement" rows={2} defaultValue={v.educationRequirement} />
        </Field>
        <Field label="Experience" htmlFor="experienceRequirement">
          <TextArea id="experienceRequirement" name="experienceRequirement" rows={2} defaultValue={v.experienceRequirement} />
        </Field>
        <Field label="Licensing / certification" htmlFor="licenseRequirement">
          <TextArea id="licenseRequirement" name="licenseRequirement" rows={2} defaultValue={v.licenseRequirement} />
        </Field>
        <Field label="Language" htmlFor="languageRequirement">
          <TextArea id="languageRequirement" name="languageRequirement" rows={2} defaultValue={v.languageRequirement} />
        </Field>
        <Field label="Minimum age" htmlFor="minAge">
          <TextInput id="minAge" name="minAge" type="number" min={0} max={120} defaultValue={v.minAge ?? ""} />
        </Field>
        <Field label="Maximum age" htmlFor="maxAge">
          <TextInput id="maxAge" name="maxAge" type="number" min={0} max={120} defaultValue={v.maxAge ?? ""} />
        </Field>
        <Field label="Gender requirement" htmlFor="genderRequirement">
          <Select id="genderRequirement" name="genderRequirement" defaultValue={v.genderRequirement ?? ""}>
            <option value="">Not set</option>
            <option value="any">Any</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </Select>
        </Field>
        <Field label="Medical requirement" htmlFor="medicalRequirement">
          <TextArea id="medicalRequirement" name="medicalRequirement" rows={2} defaultValue={v.medicalRequirement} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox name="passportRequired" label="Valid passport required" defaultChecked={v.passportRequired ?? true} />
        </div>
      </Section>

      <Section title="Benefits">
        <div>
          <Checkbox name="accommodationProvided" label="Accommodation provided" defaultChecked={v.accommodationProvided} />
          <TextInput className="mt-2" name="accommodation" placeholder="Details (optional)" defaultValue={v.accommodation} />
        </div>
        <div>
          <Checkbox name="mealsProvided" label="Meals provided" defaultChecked={v.mealsProvided} />
          <TextInput className="mt-2" name="meals" placeholder="Details (optional)" defaultValue={v.meals} />
        </div>
        <Checkbox name="transportProvided" label="Transport provided" defaultChecked={v.transportProvided} />
        <Checkbox name="airfareProvided" label="Airfare provided" defaultChecked={v.airfareProvided} />
        <Checkbox
          name="visaWorkPermitSupport"
          label="Visa / work permit support"
          defaultChecked={v.visaWorkPermitSupport}
        />
        <div className="sm:col-span-2">
          <Field label="Other benefits" htmlFor="benefits">
            <TextArea id="benefits" name="benefits" rows={2} defaultValue={v.benefits} />
          </Field>
        </div>
      </Section>

      <Section title="Application">
        <Field label="Opening date" htmlFor="openingDate">
          <TextInput id="openingDate" name="openingDate" type="date" defaultValue={v.openingDate} />
        </Field>
        <Field label="Application deadline" htmlFor="applicationDeadline" hint="Candidate-facing deadline">
          <TextInput id="applicationDeadline" name="applicationDeadline" type="date" defaultValue={v.applicationDeadline} />
        </Field>
        <Field
          label="Expiry"
          htmlFor="expiryAt"
          hint="Hard cutoff — job automatically stops being shown as open after this date"
        >
          <TextInput id="expiryAt" name="expiryAt" type="date" defaultValue={v.expiryAt} />
        </Field>
        <Field label="Source" htmlFor="source" hint="Where this listing came from, e.g. recruiter_import">
          <TextInput id="source" name="source" defaultValue={v.source} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Application instructions" htmlFor="applicationProcess">
            <TextArea id="applicationProcess" name="applicationProcess" rows={2} defaultValue={v.applicationProcess} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Fees" htmlFor="fees" hint="Shown to staff only — never invent a fee schedule">
            <TextArea id="fees" name="fees" rows={2} defaultValue={v.fees} />
          </Field>
        </div>
      </Section>

      <Section title="Description">
        <div className="sm:col-span-2">
          <Field label="Job description" htmlFor="jobDescription">
            <TextArea id="jobDescription" name="jobDescription" rows={4} defaultValue={v.jobDescription} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Responsibilities" htmlFor="responsibilities">
            <TextArea id="responsibilities" name="responsibilities" rows={4} defaultValue={v.responsibilities} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Candidate requirements (summary)" htmlFor="candidateRequirements">
            <TextArea id="candidateRequirements" name="candidateRequirements" rows={3} defaultValue={v.candidateRequirements} />
          </Field>
        </div>
      </Section>

      <Section title="Internal">
        <div className="sm:col-span-2">
          <Field label="Internal notes" htmlFor="notes" hint="Not shown to candidates">
            <TextArea id="notes" name="notes" rows={3} defaultValue={v.notes} />
          </Field>
        </div>
      </Section>

      <div className="flex gap-3">
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </PrimaryButton>
        <Link href={cancelHref}>
          <SecondaryButton type="button">Cancel</SecondaryButton>
        </Link>
      </div>
    </form>
  );
}

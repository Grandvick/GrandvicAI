"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, TextArea, Select, PrimaryButton, SecondaryButton } from "@/components/ui/field";
import type { FormState } from "../actions";

type Option = { id: string; label: string };

export function ApplicationForm({
  action,
  customers,
  leads,
  opportunities,
  lockedCustomer,
  defaultValues,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  customers: Option[];
  leads: Option[];
  opportunities: Option[];
  lockedCustomer?: Option;
  defaultValues?: { leadId?: string; opportunityId?: string };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <Field label="Customer" htmlFor="customerId" required error={state?.fieldErrors?.customerId}>
        {lockedCustomer ? (
          <>
            <input type="hidden" name="customerId" value={lockedCustomer.id} />
            <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {lockedCustomer.label}
            </div>
          </>
        ) : (
          <Select id="customerId" name="customerId" defaultValue="" required>
            <option value="" disabled>
              Select a customer…
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Related lead" htmlFor="leadId" hint="Optional — links back to the sales pipeline">
        <Select id="leadId" name="leadId" defaultValue={defaultValues?.leadId ?? ""}>
          <option value="">None</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Job" htmlFor="opportunityId" hint="Optional — links this application to a specific Jobs Abroad opportunity">
        <Select id="opportunityId" name="opportunityId" defaultValue={defaultValues?.opportunityId ?? ""}>
          <option value="">None (general application)</option>
          {opportunities.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Status" htmlFor="status">
        <Select id="status" name="status" defaultValue="new">
          <option value="new">New</option>
          <option value="screening">Screening</option>
          <option value="documents_pending">Documents pending</option>
          <option value="documents_complete">Documents complete</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="submitted_to_recruiter">Submitted to recruiter</option>
          <option value="interview_scheduled">Interview scheduled</option>
          <option value="interview_completed">Interview completed</option>
          <option value="selected">Selected</option>
          <option value="offer_received">Offer received</option>
          <option value="visa_processing">Visa processing</option>
          <option value="deployment_pending">Deployment pending</option>
          <option value="placed">Placed</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes">
        <TextArea id="notes" name="notes" rows={2} />
      </Field>
      <div className="flex gap-3 pt-2">
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </PrimaryButton>
        <Link href="/applications">
          <SecondaryButton type="button">Cancel</SecondaryButton>
        </Link>
      </div>
    </form>
  );
}

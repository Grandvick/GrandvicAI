"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from "@/components/ui/field";
import type { FormState } from "../actions";

type Option = { id: string; fullName: string };

export function DocumentRequestForm({
  action,
  customers,
  lockedCustomer,
  applicationId,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  customers: Option[];
  lockedCustomer?: Option;
  applicationId?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
      <Field label="Customer" htmlFor="customerId" required error={state?.fieldErrors?.customerId}>
        {lockedCustomer ? (
          <>
            <input type="hidden" name="customerId" value={lockedCustomer.id} />
            <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {lockedCustomer.fullName}
            </div>
          </>
        ) : (
          <Select id="customerId" name="customerId" defaultValue="" required>
            <option value="" disabled>
              Select a customer…
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Document type"
        htmlFor="documentType"
        required
        hint="e.g. Passport, CV, Good Conduct Certificate"
        error={state?.fieldErrors?.documentType}
      >
        <TextInput id="documentType" name="documentType" required />
      </Field>
      <Field label="Notes" htmlFor="notes">
        <TextArea id="notes" name="notes" rows={2} />
      </Field>
      <div className="flex gap-3 pt-2">
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </PrimaryButton>
        <Link href="/documents">
          <SecondaryButton type="button">Cancel</SecondaryButton>
        </Link>
      </div>
    </form>
  );
}

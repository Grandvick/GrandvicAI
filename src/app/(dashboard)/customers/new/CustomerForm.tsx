"use client";

import { useActionState } from "react";
import { Field, TextInput, TextArea, PrimaryButton, SecondaryButton } from "@/components/ui/field";
import Link from "next/link";
import type { FormState } from "../actions";

export function CustomerForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaultValues?: {
    fullName?: string;
    phone?: string;
    email?: string;
    country?: string;
    profession?: string;
    notes?: string;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <Field label="Full name" htmlFor="fullName" required error={state?.fieldErrors?.fullName}>
        <TextInput id="fullName" name="fullName" defaultValue={defaultValues?.fullName} required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone" htmlFor="phone" error={state?.fieldErrors?.phone}>
          <TextInput id="phone" name="phone" defaultValue={defaultValues?.phone} placeholder="+254…" />
        </Field>
        <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
          <TextInput id="email" name="email" type="email" defaultValue={defaultValues?.email} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Country" htmlFor="country" error={state?.fieldErrors?.country}>
          <TextInput id="country" name="country" defaultValue={defaultValues?.country} placeholder="Kenya" />
        </Field>
        <Field label="Profession" htmlFor="profession" error={state?.fieldErrors?.profession}>
          <TextInput id="profession" name="profession" defaultValue={defaultValues?.profession} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes" error={state?.fieldErrors?.notes}>
        <TextArea id="notes" name="notes" rows={3} defaultValue={defaultValues?.notes} />
      </Field>

      <div className="flex gap-3 pt-2">
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </PrimaryButton>
        <Link href="/customers">
          <SecondaryButton type="button">Cancel</SecondaryButton>
        </Link>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from "@/components/ui/field";
import type { FormState } from "../actions";

type Option = { id: string; fullName?: string; label?: string };

export function TaskForm({
  action,
  defaultValues,
  customers,
  leads,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaultValues?: {
    title?: string;
    description?: string;
    dueDate?: string;
    priority?: string;
    relatedCustomerId?: string;
    relatedLeadId?: string;
    notes?: string;
  };
  customers: Option[];
  leads: Option[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <Field label="Title" htmlFor="title" required error={state?.fieldErrors?.title}>
        <TextInput id="title" name="title" defaultValue={defaultValues?.title} required />
      </Field>
      <Field label="Description" htmlFor="description">
        <TextArea id="description" name="description" rows={3} defaultValue={defaultValues?.description} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Due date" htmlFor="dueDate">
          <TextInput id="dueDate" name="dueDate" type="date" defaultValue={defaultValues?.dueDate} />
        </Field>
        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={defaultValues?.priority ?? "medium"}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Related customer" htmlFor="relatedCustomerId">
          <Select
            id="relatedCustomerId"
            name="relatedCustomerId"
            defaultValue={defaultValues?.relatedCustomerId ?? ""}
          >
            <option value="">None</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Related lead" htmlFor="relatedLeadId">
          <Select id="relatedLeadId" name="relatedLeadId" defaultValue={defaultValues?.relatedLeadId ?? ""}>
            <option value="">None</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <TextArea id="notes" name="notes" rows={2} defaultValue={defaultValues?.notes} />
      </Field>
      <div className="flex gap-3 pt-2">
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </PrimaryButton>
        <Link href="/tasks">
          <SecondaryButton type="button">Cancel</SecondaryButton>
        </Link>
      </div>
    </form>
  );
}

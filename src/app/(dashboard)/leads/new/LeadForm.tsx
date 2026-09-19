"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from "@/components/ui/field";
import type { FormState } from "../actions";
import type { PipelineStage } from "@/lib/business/pipeline-stages";

type CustomerOption = { id: string; fullName: string };

export function LeadForm({
  action,
  defaultValues,
  customers,
  stages,
  lockedCustomer,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaultValues?: {
    service?: string;
    targetCountry?: string;
    source?: string;
    stage?: string;
    score?: number;
    temperature?: string;
  };
  customers: CustomerOption[];
  stages: PipelineStage[];
  lockedCustomer?: CustomerOption;
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

      <div className="grid grid-cols-2 gap-4">
        <Field label="Service" htmlFor="service" hint="e.g. Registered Nurse, Tour package">
          <TextInput id="service" name="service" defaultValue={defaultValues?.service} />
        </Field>
        <Field label="Target country" htmlFor="targetCountry">
          <TextInput id="targetCountry" name="targetCountry" defaultValue={defaultValues?.targetCountry} />
        </Field>
      </div>

      <Field label="Source" htmlFor="source" hint="e.g. WhatsApp, Facebook ad, referral">
        <TextInput id="source" name="source" defaultValue={defaultValues?.source} />
      </Field>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Stage" htmlFor="stage">
          <Select id="stage" name="stage" defaultValue={defaultValues?.stage ?? stages[0]?.key ?? "new"}>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Temperature" htmlFor="temperature">
          <Select id="temperature" name="temperature" defaultValue={defaultValues?.temperature ?? "nurture"}>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="nurture">Nurture</option>
          </Select>
        </Field>
        <Field label="Score" htmlFor="score" error={state?.fieldErrors?.score}>
          <TextInput
            id="score"
            name="score"
            type="number"
            min={0}
            max={100}
            defaultValue={defaultValues?.score ?? 0}
          />
        </Field>
      </div>

      <div className="flex gap-3 pt-2">
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </PrimaryButton>
        <Link href="/leads">
          <SecondaryButton type="button">Cancel</SecondaryButton>
        </Link>
      </div>
    </form>
  );
}

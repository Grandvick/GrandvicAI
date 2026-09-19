"use client";

import { useActionState } from "react";
import { Field, Select, TextInput, PrimaryButton } from "@/components/ui/field";
import type { FormState } from "../actions";

type StaffOption = { id: string; name: string };
type StageOption = { key: string; label: string };

export function PipelineEditor({
  action,
  stages,
  staff,
  defaultValues,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  stages: StageOption[];
  staff: StaffOption[];
  defaultValues: { stage: string; temperature: string; score: number; assignedTo: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <Field label="Stage" htmlFor="stage">
        <Select id="stage" name="stage" defaultValue={defaultValues.stage}>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Temperature" htmlFor="temperature">
        <Select id="temperature" name="temperature" defaultValue={defaultValues.temperature}>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="nurture">Nurture</option>
        </Select>
      </Field>
      <Field label="Score" htmlFor="score">
        <TextInput id="score" name="score" type="number" min={0} max={100} defaultValue={defaultValues.score} />
      </Field>
      <Field label="Assigned to" htmlFor="assignedTo">
        <Select id="assignedTo" name="assignedTo" defaultValue={defaultValues.assignedTo ?? ""}>
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save pipeline changes"}
      </PrimaryButton>
    </form>
  );
}

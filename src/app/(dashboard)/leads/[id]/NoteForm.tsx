"use client";

import { useActionState, useEffect, useRef } from "react";
import { TextArea, PrimaryButton } from "@/components/ui/field";
import type { FormState } from "../actions";

export function NoteForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && state !== undefined && !state?.error && !state?.fieldErrors) {
      formRef.current?.reset();
    }
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state?.fieldErrors?.note && <p className="text-xs text-red-600">{state.fieldErrors.note}</p>}
      <TextArea name="note" rows={2} placeholder="Add a note…" required />
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add note"}
      </PrimaryButton>
    </form>
  );
}

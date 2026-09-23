"use client";

import { useActionState, useTransition } from "react";
import { addJobDocumentRequirementAction, removeJobDocumentRequirementAction } from "../actions";
import type { FormState } from "../actions";
import type { JobDocumentRequirement } from "@/lib/business/job-documents";

/** Common document types, offered as suggestions only — spec section 10 explicitly forbids hard-coding this list. */
const SUGGESTIONS = [
  "passport",
  "cv",
  "academic_certificates",
  "good_conduct_certificate",
  "medical_certificate",
  "reference_letters",
  "passport_photo",
];

export function DocumentRequirementsEditor({
  opportunityId,
  requirements,
}: {
  opportunityId: string;
  requirements: JobDocumentRequirement[];
}) {
  const boundAdd = addJobDocumentRequirementAction.bind(null, opportunityId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(boundAdd, undefined);
  const [removePending, startRemove] = useTransition();

  function remove(requirementId: string) {
    startRemove(async () => {
      await removeJobDocumentRequirementAction(requirementId, opportunityId);
    });
  }

  const existingTypes = new Set(requirements.map((r) => r.documentType.toLowerCase()));

  return (
    <div className="space-y-3">
      {requirements.length === 0 ? (
        <p className="text-sm text-slate-500">No document requirements set for this job yet.</p>
      ) : (
        <ul className="space-y-2">
          {requirements.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
            >
              <span className="text-slate-900">
                {r.documentType}
                {r.isMandatory && <span className="text-red-500"> *</span>}
              </span>
              <button
                type="button"
                disabled={removePending}
                onClick={() => remove(r.id)}
                className="text-xs font-medium text-slate-400 hover:text-red-600 disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Document type</label>
          <input
            list="doc-type-suggestions"
            name="documentType"
            placeholder="e.g. passport"
            required
            className="mt-1 w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <datalist id="doc-type-suggestions">
            {SUGGESTIONS.filter((s) => !existingTypes.has(s)).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" name="isMandatory" defaultChecked className="h-3.5 w-3.5" />
          Mandatory
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {pending ? "Adding…" : "+ Add requirement"}
        </button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.fieldErrors?.documentType && <p className="text-xs text-red-600">{state.fieldErrors.documentType}</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { updateApplicationStatusAction } from "./actions";
import { formatStatusLabel } from "@/components/ui/badge";

const OPTIONS = [
  "new",
  "screening",
  "documents_pending",
  "documents_complete",
  "shortlisted",
  "submitted_to_recruiter",
  "interview_scheduled",
  "interview_completed",
  "selected",
  "offer_received",
  "visa_processing",
  "deployment_pending",
  "placed",
  "rejected",
  "withdrawn",
] as const;

const REASON_REQUIRED = new Set(["rejected", "withdrawn"]);

export function StatusSelect({ applicationId, status }: { applicationId: string; status: string }) {
  const [value, setValue] = useState(status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const previous = value;

    let reason: string | undefined;
    if (REASON_REQUIRED.has(next)) {
      const entered = window.prompt(`Optional: reason for marking this ${next.replace("_", " ")}`);
      if (entered === null) return; // user cancelled the prompt — leave status unchanged
      reason = entered.trim() || undefined;
    }

    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateApplicationStatusAction(applicationId, next, reason);
      if (result?.error) {
        setError(result.error);
        setValue(previous);
      }
    });
  }

  return (
    <div>
      <select
        value={value}
        disabled={isPending}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
      >
        {OPTIONS.map((o) => (
          <option key={o} value={o}>
            {formatStatusLabel(o)}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

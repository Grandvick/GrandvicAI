"use client";

import { useState, useTransition } from "react";
import { updateApplicationStatusAction } from "./actions";

const OPTIONS = [
  "draft",
  "submitted",
  "under_review",
  "interview",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

export function StatusSelect({ applicationId, status }: { applicationId: string; status: string }) {
  const [value, setValue] = useState(status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateApplicationStatusAction(applicationId, next);
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
            {o.replace("_", " ")}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

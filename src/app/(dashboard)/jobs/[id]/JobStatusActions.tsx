"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStatusAction, duplicateJobAction } from "../actions";
import type { JobStatus } from "@/lib/business/jobs";

const TRANSITIONS: Partial<Record<JobStatus, { to: JobStatus; label: string; confirm?: string }[]>> = {
  draft: [
    { to: "pending_review", label: "Submit for review" },
    { to: "open", label: "Open job" },
  ],
  pending_review: [
    { to: "draft", label: "Back to draft" },
    { to: "open", label: "Open job" },
  ],
  open: [
    { to: "paused", label: "Pause" },
    { to: "closed", label: "Close job", confirm: "Close this job? It will stop being shown as open." },
  ],
  paused: [
    { to: "open", label: "Reopen" },
    { to: "closed", label: "Close job", confirm: "Close this job? It will stop being shown as open." },
  ],
  expired: [
    { to: "open", label: "Reopen (extend expiry first)" },
    { to: "closed", label: "Close job" },
  ],
  closed: [],
};

export function JobStatusActions({ jobId, status }: { jobId: string; status: JobStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingTo, setPendingTo] = useState<JobStatus | null>(null);

  function changeStatus(to: JobStatus, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(null);
    setPendingTo(to);
    startTransition(async () => {
      const result = await setJobStatusAction(jobId, to);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  function duplicate() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateJobAction(jobId);
      if (result?.error) setError(result.error);
      else if (result.newJobId) router.push(`/jobs/${result.newJobId}`);
    });
  }

  const options = TRANSITIONS[status] ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.to}
            type="button"
            disabled={isPending}
            onClick={() => changeStatus(opt.to, opt.confirm)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {isPending && pendingTo === opt.to ? "Saving…" : opt.label}
          </button>
        ))}
        <button
          type="button"
          disabled={isPending}
          onClick={duplicate}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
        >
          Duplicate job
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

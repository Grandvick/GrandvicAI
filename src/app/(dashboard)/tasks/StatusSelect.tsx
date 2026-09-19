"use client";

import { useState, useTransition } from "react";
import { updateTaskStatusAction } from "./actions";
import type { TaskItem } from "@/lib/business/tasks";

const OPTIONS: TaskItem["status"][] = ["pending", "in_progress", "done", "cancelled"];

export function StatusSelect({ taskId, status }: { taskId: string; status: TaskItem["status"] }) {
  const [value, setValue] = useState(status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: TaskItem["status"]) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateTaskStatusAction(taskId, next);
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
        onChange={(e) => onChange(e.target.value as TaskItem["status"])}
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

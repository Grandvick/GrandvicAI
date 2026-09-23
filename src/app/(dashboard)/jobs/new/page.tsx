import { createJobAction } from "../actions";
import { JobForm } from "../JobForm";

export const dynamic = "force-dynamic";

export default function NewJobPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New job opportunity</h1>
        <p className="mt-1 text-sm text-slate-500">
          Saved as a draft — nothing is shown to candidates or promoted anywhere until you open it.
        </p>
      </div>
      <JobForm action={createJobAction} submitLabel="Create draft job" cancelHref="/jobs" />
    </div>
  );
}

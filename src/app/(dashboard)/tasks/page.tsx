import Link from "next/link";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listTasks } from "@/lib/business/tasks";
import { Badge, priorityTone } from "@/components/ui/badge";
import { StatusSelect } from "./StatusSelect";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);
  const tasks = await listTasks(supabase, businessId, { status });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/tasks/new"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + New task
        </Link>
      </div>

      <form className="flex gap-2">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {tasks.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No tasks match these filters.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Related</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {t.title}
                    {t.description && (
                      <p className="mt-0.5 text-xs font-normal text-slate-500">{t.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.relatedCustomerId ? (
                      <Link href={`/customers/${t.relatedCustomerId}`} className="hover:underline">
                        {t.relatedCustomerName ?? "Customer"}
                      </Link>
                    ) : t.relatedLeadId ? (
                      <Link href={`/leads/${t.relatedLeadId}`} className="hover:underline">
                        Lead
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.ownerName || "—"}</td>
                  <td className="px-4 py-3">
                    <StatusSelect taskId={t.id} status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listApplications } from "@/lib/business/applications";
import { StatusSelect } from "./StatusSelect";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);
  const applications = await listApplications(supabase, businessId, { customerId });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
          <p className="mt-1 text-sm text-slate-500">
            {applications.length} application{applications.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href={customerId ? `/applications/new?customerId=${customerId}` : "/applications/new"}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + New application
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {applications.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No applications yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Applied</th>
                <th className="px-4 py-3">Stage</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/applications/${a.id}`} className="hover:underline">
                      {a.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {a.opportunityTitle || "General application"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <StatusSelect applicationId={a.id} status={a.status} />
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

import Link from "next/link";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listJobs, getJobsSummary } from "@/lib/business/jobs";
import { StatCard } from "@/components/dashboard/StatCard";
import { Badge, jobStatusTone, formatStatusLabel } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    country?: string;
    category?: string;
    recruiterName?: string;
    search?: string;
    sort?: "deadline" | "newest";
  }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [jobs, summary] = await Promise.all([
    listJobs(supabase, businessId, params),
    getJobsSummary(supabase, businessId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Jobs Abroad</h1>
          <p className="mt-1 text-sm text-slate-500">
            {jobs.length} job{jobs.length === 1 ? "" : "s"} matching your filters
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + New job
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total jobs" value={summary.totalJobs} />
        <StatCard label="Open" value={summary.openJobs} tone="good" />
        <StatCard label="Paused" value={summary.pausedJobs} tone="warm" />
        <StatCard label="Expiring soon" value={summary.expiringSoonJobs} tone="warm" />
        <StatCard label="Expired" value={summary.expiredJobs} tone="hot" />
        <StatCard label="Closed" value={summary.closedJobs} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Total applications" value={summary.totalApplications} />
        <StatCard label="New applicants" value={summary.newApplicants} />
        <StatCard label="Awaiting documents" value={summary.candidatesAwaitingDocuments} />
        <StatCard label="Awaiting interview" value={summary.candidatesAwaitingInterview} />
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-500">Search</label>
          <input
            type="text"
            name="search"
            defaultValue={params.search}
            placeholder="Title, country, employer, recruiter…"
            className="mt-1 w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Status</label>
          <select name="status" defaultValue={params.status ?? ""} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="pending_review">Pending review</option>
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Country</label>
          <input
            type="text"
            name="country"
            defaultValue={params.country}
            className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Category</label>
          <input
            type="text"
            name="category"
            defaultValue={params.category}
            className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Sort</label>
          <select name="sort" defaultValue={params.sort ?? "newest"} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="newest">Newest first</option>
            <option value="deadline">Deadline soonest</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
          Apply filters
        </button>
        {(params.status || params.country || params.category || params.search || params.recruiterName) && (
          <Link href="/jobs" className="text-sm text-slate-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {jobs.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No jobs match these filters.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Recruiter</th>
                <th className="px-4 py-3">Deadline</th>
                <th className="px-4 py-3">Vacancies</th>
                <th className="px-4 py-3">Applicants</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/jobs/${j.id}`} className="hover:underline">
                      {j.title}
                    </Link>
                    {j.employer && <p className="text-xs font-normal text-slate-400">{j.employer}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {[j.city, j.country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{j.recruiterName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {j.applicationDeadline ? new Date(j.applicationDeadline).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{j.numVacancies ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{j.applicantCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={jobStatusTone(j.effectiveStatus)}>{formatStatusLabel(j.effectiveStatus)}</Badge>
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

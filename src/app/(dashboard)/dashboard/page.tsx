import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardOverview } from "@/lib/business/dashboard";
import { StatCard } from "@/components/dashboard/StatCard";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: overview, error } = await getDashboardOverview(supabase);

  const priorities = [
    overview.hotLeads > 0 && `🔥 ${overview.hotLeads} hot lead${overview.hotLeads === 1 ? "" : "s"} require attention`,
    overview.pendingDocuments > 0 &&
      `📄 ${overview.pendingDocuments} document${overview.pendingDocuments === 1 ? "" : "s"} awaiting review`,
    overview.contentAwaitingApproval > 0 &&
      `📱 ${overview.contentAwaitingApproval} post${overview.contentAwaitingApproval === 1 ? "" : "s"} require approval`,
    overview.followUpsDue > 0 &&
      `📞 ${overview.followUpsDue} follow-up${overview.followUpsDue === 1 ? "" : "s"} due today`,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Good day 👋</h1>
        <p className="mt-1 text-sm text-slate-500">
          Here&rsquo;s what&rsquo;s happening across Grandvic Tours &amp; Travel today.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <StatCard label="New Leads" value={overview.newLeads} />
        <StatCard label="Hot Leads" value={overview.hotLeads} tone="hot" />
        <StatCard label="Warm Leads" value={overview.warmLeads} tone="warm" />
        <StatCard label="Follow-ups Due" value={overview.followUpsDue} />
        <StatCard label="Active Applications" value={overview.activeApplications} />
        <StatCard label="Pending Documents" value={overview.pendingDocuments} />
        <StatCard label="Payments Due" value={overview.paymentsDue} />
        <StatCard label="Posts Awaiting Approval" value={overview.contentAwaitingApproval} />
        <StatCard label="Scheduled Posts" value={overview.scheduledPosts} tone="good" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Today&rsquo;s Priorities</h2>
        {priorities.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Nothing urgent right now — new leads, documents and content will show up here
            automatically.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {priorities.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
        This is the Phase 0 foundation dashboard — it reads real numbers from your database
        (including the demo data from <span className="font-mono">supabase/seed.sql</span> if you
        loaded it), but full lead/customer management screens arrive in Phase 1. See{" "}
        <span className="font-mono">DEVELOPMENT_PROGRESS.md</span> for the roadmap.
      </div>
    </div>
  );
}

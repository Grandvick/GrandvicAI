import Link from "next/link";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listLeads } from "@/lib/business/leads";
import { listPipelineStages } from "@/lib/business/pipeline-stages";
import { Badge, temperatureTone } from "@/components/ui/badge";
import { PipelineBoard } from "./PipelineBoard";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; temperature?: string }>;
}) {
  const { view = "board", q, temperature } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [leads, stages] = await Promise.all([
    listLeads(supabase, businessId, { search: q, temperature, activeOnly: true }),
    listPipelineStages(supabase, businessId),
  ]);

  const baseQuery: Record<string, string> = {};
  if (q) baseQuery.q = q;
  if (temperature) baseQuery.temperature = temperature;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">
            {leads.length} active lead{leads.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/leads/new"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + New lead
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="view" value={view} />
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by customer, service, country…"
            className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <select
            name="temperature"
            defaultValue={temperature ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All temperatures</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="nurture">Nurture</option>
          </select>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Filter
          </button>
        </form>

        <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm">
          <Link
            href={{ pathname: "/leads", query: { ...baseQuery, view: "board" } }}
            className={`rounded-md px-3 py-1.5 ${view === "board" ? "bg-slate-900 text-white" : "text-slate-600"}`}
          >
            Board
          </Link>
          <Link
            href={{ pathname: "/leads", query: { ...baseQuery, view: "list" } }}
            className={`rounded-md px-3 py-1.5 ${view === "list" ? "bg-slate-900 text-white" : "text-slate-600"}`}
          >
            List
          </Link>
        </div>
      </div>

      {view === "list" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {leads.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No leads match these filters.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Temperature</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/leads/${l.id}`} className="hover:underline">
                        {l.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.service || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{l.targetCountry || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone="slate">{l.stage}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={temperatureTone(l.temperature)}>{l.temperature}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.score}</td>
                    <td className="px-4 py-3 text-slate-600">{l.assignedToName || "Unassigned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <PipelineBoard stages={stages} leads={leads} />
      )}
    </div>
  );
}

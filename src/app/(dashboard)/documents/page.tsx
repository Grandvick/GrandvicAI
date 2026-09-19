import Link from "next/link";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listDocuments } from "@/lib/business/documents";
import { DocumentRow } from "./DocumentRow";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);
  const documents = await listDocuments(supabase, businessId, { customerId });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
          <p className="mt-1 text-sm text-slate-500">
            {documents.length} document{documents.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        <Link
          href={customerId ? `/documents/new?customerId=${customerId}` : "/documents/new"}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + Request document
        </Link>
      </div>

      {customerId && (
        <p className="text-sm text-slate-500">
          Showing documents for this customer only.{" "}
          <Link href="/documents" className="text-slate-700 hover:underline">
            View all documents →
          </Link>
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {documents.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No documents requested yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">File</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-400">
        Files are stored in a private Supabase Storage bucket and only ever accessed through
        short-lived signed links (never a permanent public URL). AI-assisted &ldquo;looks
        complete&rdquo; checks and job-specific document requirements arrive with the Jobs
        Module (Phase 2) — a human always makes the approve/reject decision here.
      </div>
    </div>
  );
}

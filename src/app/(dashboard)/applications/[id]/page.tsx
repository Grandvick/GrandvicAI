import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/business/context";
import { getApplication } from "@/lib/business/applications";
import { listApplicationEvents } from "@/lib/business/application-events";
import { getApplicationDocumentChecklist } from "@/lib/business/job-documents";
import { Badge, statusTone, formatStatusLabel } from "@/components/ui/badge";
import { StatusSelect } from "../StatusSelect";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  created: "Application created",
  status_changed: "Stage changed",
  documents_completed: "All required documents approved",
};

function formatEventType(type: string): string {
  return EVENT_LABELS[type] ?? formatStatusLabel(type);
}

const DOC_STATUS_TONE: Record<string, "slate" | "info" | "good" | "danger"> = {
  missing: "slate",
  requested: "info",
  uploaded: "info",
  received: "info",
  pending_review: "info",
  approved: "good",
  rejected: "danger",
  expired: "danger",
};

export default async function ApplicationDetailPage({ params }: PageProps<"/applications/[id]">) {
  const { id } = await params;
  const { supabase } = await requireCurrentUser();

  const application = await getApplication(supabase, id);
  if (!application) notFound();

  const [events, checklist] = await Promise.all([
    listApplicationEvents(supabase, id),
    getApplicationDocumentChecklist(supabase, id),
  ]);

  const missingMandatory = checklist.filter((c) => c.isMandatory && c.status === "missing").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Application</p>
          <h1 className="text-2xl font-semibold text-slate-900">{application.customerName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {application.opportunityTitle ? (
              application.opportunityId ? (
                <Link href={`/jobs/${application.opportunityId}`} className="hover:underline">
                  {application.opportunityTitle}
                </Link>
              ) : (
                application.opportunityTitle
              )
            ) : (
              "General application (not linked to a specific job)"
            )}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={statusTone(application.status)}>{formatStatusLabel(application.status)}</Badge>
            {application.submittedAt && (
              <span className="text-xs text-slate-400">
                Submitted {new Date(application.submittedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href={`/customers/${application.customerId}`} className="text-sm text-slate-500 hover:underline">
            View candidate →
          </Link>
          <Link href="/applications" className="text-sm text-slate-500 hover:underline">
            ← All applications
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Recruitment stage</h2>
            <StatusSelect applicationId={application.id} status={application.status} />
            {application.rejectionReason && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                Reason: {application.rejectionReason}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Documents</h2>
              {missingMandatory > 0 && <Badge tone="danger">{missingMandatory} missing</Badge>}
            </div>
            {!application.opportunityId ? (
              <p className="text-sm text-slate-500">
                No job linked — document requirements are defined per job.
              </p>
            ) : checklist.length === 0 ? (
              <p className="text-sm text-slate-500">This job has no document requirements defined yet.</p>
            ) : (
              <ul className="space-y-2">
                {checklist.map((c) => (
                  <li
                    key={c.documentType}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <span className="text-slate-900">
                      {c.documentType}
                      {c.isMandatory && <span className="text-red-500"> *</span>}
                    </span>
                    <Badge tone={DOC_STATUS_TONE[c.status] ?? "slate"}>{formatStatusLabel(c.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {application.opportunityId && (
              <Link
                href={`/documents/new?customerId=${application.customerId}&applicationId=${application.id}`}
                className="mt-3 inline-block text-xs font-medium text-slate-600 hover:underline"
              >
                + Request a document
              </Link>
            )}
          </div>

          {application.notes && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Notes</h2>
              <p className="text-sm text-slate-600">{application.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Activity timeline</h2>
            {events.length === 0 ? (
              <p className="text-sm text-slate-500">No activity recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                    <p className="font-medium text-slate-900">{formatEventType(e.eventType)}</p>
                    {e.eventType === "status_changed" &&
                      typeof e.payload.from === "string" &&
                      typeof e.payload.to === "string" && (
                        <p className="text-slate-600">
                          {formatStatusLabel(e.payload.from)} → {formatStatusLabel(e.payload.to)}
                        </p>
                      )}
                    <p className="text-xs text-slate-400">
                      {new Date(e.createdAt).toLocaleString()}
                      {e.createdByName ? ` · ${e.createdByName}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

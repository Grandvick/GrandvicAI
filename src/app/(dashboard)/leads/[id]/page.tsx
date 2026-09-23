import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/business/context";
import { getLead } from "@/lib/business/leads";
import { listLeadEvents } from "@/lib/business/lead-events";
import { listPipelineStages } from "@/lib/business/pipeline-stages";
import { listStaff } from "@/lib/business/staff";
import { listTasks } from "@/lib/business/tasks";
import { listApplications } from "@/lib/business/applications";
import { Badge, temperatureTone, statusTone, formatStatusLabel } from "@/components/ui/badge";
import { updateLeadPipelineAction, addLeadNoteAction } from "../actions";
import { PipelineEditor } from "./PipelineEditor";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  created: "Lead created",
  note_added: "Note added",
  stage_changed: "Stage changed",
  score_changed: "Score changed",
  temperature_changed: "Temperature changed",
  assigned_to_changed: "Reassigned",
};

function formatEventType(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export default async function LeadDetailPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const { supabase } = await requireCurrentUser();

  const lead = await getLead(supabase, id);
  if (!lead) notFound();

  const [events, stages, staff, tasks, applications] = await Promise.all([
    listLeadEvents(supabase, id),
    listPipelineStages(supabase, lead.businessId),
    listStaff(supabase, lead.businessId),
    listTasks(supabase, lead.businessId, { relatedLeadId: id }),
    listApplications(supabase, lead.businessId, { leadId: id }),
  ]);

  const boundPipelineUpdate = updateLeadPipelineAction.bind(null, id);
  const boundAddNote = addLeadNoteAction.bind(null, id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Lead</p>
          <h1 className="text-2xl font-semibold text-slate-900">{lead.customerName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {lead.service || "No service set"} {lead.targetCountry ? `→ ${lead.targetCountry}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone="slate">{lead.stage}</Badge>
            <Badge tone={temperatureTone(lead.temperature)}>{lead.temperature}</Badge>
            <span className="text-xs text-slate-400">Score {lead.score}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href={`/customers/${lead.customerId}`} className="text-sm text-slate-500 hover:underline">
            View customer →
          </Link>
          <Link href="/leads" className="text-sm text-slate-500 hover:underline">
            ← All leads
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Pipeline</h2>
            <PipelineEditor
              action={boundPipelineUpdate}
              stages={stages}
              staff={staff}
              defaultValues={{
                stage: lead.stage,
                temperature: lead.temperature,
                score: lead.score,
                assignedTo: lead.assignedTo,
              }}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Add note</h2>
            <NoteForm action={boundAddNote} />
          </div>
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
                    {e.eventType === "note_added" && typeof e.payload.note === "string" && (
                      <p className="text-slate-600">{e.payload.note}</p>
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

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Tasks ({tasks.length})</h2>
              <Link
                href={`/tasks/new?leadId=${id}`}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                + New task
              </Link>
            </div>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-500">No tasks linked to this lead.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <span className="text-slate-900">{t.title}</span>
                    <Badge tone={statusTone(t.status)}>{t.status.replace("_", " ")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Applications ({applications.length})</h2>
              <Link
                href={`/applications/new?customerId=${lead.customerId}&leadId=${id}`}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                + New application
              </Link>
            </div>
            {applications.length === 0 ? (
              <p className="text-sm text-slate-500">No applications linked to this lead.</p>
            ) : (
              <ul className="space-y-2">
                {applications.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <Link href={`/applications/${a.id}`} className="text-slate-900 hover:underline">
                      {a.opportunityTitle || "General application"}
                    </Link>
                    <Badge tone={statusTone(a.status)}>{formatStatusLabel(a.status)}</Badge>
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

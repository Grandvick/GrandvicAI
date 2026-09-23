import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/business/context";
import { getCustomer } from "@/lib/business/customers";
import { listLeads } from "@/lib/business/leads";
import { listTasks } from "@/lib/business/tasks";
import { listDocuments } from "@/lib/business/documents";
import { listApplications } from "@/lib/business/applications";
import { Badge, temperatureTone, statusTone, formatStatusLabel } from "@/components/ui/badge";
import { updateCustomerAction } from "../actions";
import { CustomerForm } from "../new/CustomerForm";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const { supabase } = await requireCurrentUser();

  const customer = await getCustomer(supabase, id);
  if (!customer) notFound();

  const [leads, tasks, documents, applications] = await Promise.all([
    listLeads(supabase, customer.businessId, {}).then((all) =>
      all.filter((l) => l.customerId === id)
    ),
    listTasks(supabase, customer.businessId, { relatedCustomerId: id }),
    listDocuments(supabase, customer.businessId, { customerId: id }),
    listApplications(supabase, customer.businessId, { customerId: id }),
  ]);

  const boundUpdate = updateCustomerAction.bind(null, id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Customer</p>
          <h1 className="text-2xl font-semibold text-slate-900">{customer.fullName}</h1>
        </div>
        <Link href="/customers" className="text-sm text-slate-500 hover:underline">
          ← All customers
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Profile</h2>
            <CustomerForm
              action={boundUpdate}
              submitLabel="Save changes"
              defaultValues={{
                fullName: customer.fullName,
                phone: customer.phone ?? "",
                email: customer.email ?? "",
                country: customer.country ?? "",
                profession: customer.profession ?? "",
                notes: customer.notes ?? "",
              }}
            />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Leads ({leads.length})</h2>
              <Link
                href={`/leads/new?customerId=${id}`}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                + New lead
              </Link>
            </div>
            {leads.length === 0 ? (
              <p className="text-sm text-slate-500">No leads yet for this customer.</p>
            ) : (
              <ul className="space-y-2">
                {leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <Link href={`/leads/${l.id}`} className="font-medium text-slate-900 hover:underline">
                      {l.service || "Untitled lead"} {l.targetCountry ? `→ ${l.targetCountry}` : ""}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge tone="slate">{l.stage}</Badge>
                      <Badge tone={temperatureTone(l.temperature)}>{l.temperature}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Tasks ({tasks.length})</h2>
              <Link
                href={`/tasks/new?customerId=${id}`}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                + New task
              </Link>
            </div>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-500">No tasks linked to this customer.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
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
                href={`/applications/new?customerId=${id}`}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                + New application
              </Link>
            </div>
            {applications.length === 0 ? (
              <p className="text-sm text-slate-500">No applications yet.</p>
            ) : (
              <ul className="space-y-2">
                {applications.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <Link href={`/applications/${a.id}`} className="text-slate-900 hover:underline">
                      {a.opportunityTitle || "General application"}
                    </Link>
                    <Badge tone={statusTone(a.status)}>{formatStatusLabel(a.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Documents ({documents.length})</h2>
              <Link href={`/documents?customerId=${id}`} className="text-xs font-medium text-slate-600 hover:underline">
                Manage documents →
              </Link>
            </div>
            {documents.length === 0 ? (
              <p className="text-sm text-slate-500">No documents requested yet.</p>
            ) : (
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <span className="text-slate-900">{d.documentType}</span>
                    <Badge tone={statusTone(d.status)}>{d.status.replace("_", " ")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-400">
            Payments and multi-channel conversation history for this customer arrive in later phases
            (9 and 5, respectively).
          </div>
        </div>
      </div>
    </div>
  );
}

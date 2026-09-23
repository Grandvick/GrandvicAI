import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listCustomers } from "@/lib/business/customers";
import { listLeads } from "@/lib/business/leads";
import { listJobsForSelect } from "@/lib/business/jobs";
import { createApplicationAction } from "../actions";
import { ApplicationForm } from "./ApplicationForm";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; leadId?: string; opportunityId?: string }>;
}) {
  const { customerId, leadId, opportunityId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [customers, leads, jobs] = await Promise.all([
    listCustomers(supabase, businessId, {}),
    listLeads(supabase, businessId, {}),
    listJobsForSelect(supabase, businessId),
  ]);

  const lockedCustomer = customerId ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New application</h1>
        <p className="mt-1 text-sm text-slate-500">
          Link a candidate to a specific Jobs Abroad opportunity to track them through the full
          recruitment pipeline, or leave the job blank for a general application.
        </p>
      </div>
      <ApplicationForm
        action={createApplicationAction}
        submitLabel="Create application"
        customers={customers.map((c) => ({ id: c.id, label: c.fullName }))}
        leads={leads.map((l) => ({
          id: l.id,
          label: `${l.customerName}${l.service ? ` — ${l.service}` : ""}`,
        }))}
        opportunities={jobs.map((o) => ({
          id: o.id,
          label: `${o.title}${o.country ? ` (${o.country})` : ""}${o.status !== "open" ? ` — ${o.status}` : ""}`,
        }))}
        lockedCustomer={
          lockedCustomer ? { id: lockedCustomer.id, label: lockedCustomer.fullName } : undefined
        }
        defaultValues={{ leadId, opportunityId }}
      />
    </div>
  );
}

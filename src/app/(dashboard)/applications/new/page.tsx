import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listCustomers } from "@/lib/business/customers";
import { listLeads } from "@/lib/business/leads";
import { listOpportunitiesForSelect } from "@/lib/business/opportunities";
import { createApplicationAction } from "../actions";
import { ApplicationForm } from "./ApplicationForm";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; leadId?: string }>;
}) {
  const { customerId, leadId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [customers, leads, opportunities] = await Promise.all([
    listCustomers(supabase, businessId, {}),
    listLeads(supabase, businessId, {}),
    listOpportunitiesForSelect(supabase, businessId),
  ]);

  const lockedCustomer = customerId ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New application</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track a customer&rsquo;s application status. Full job matching and requirement
          checklists arrive with the Jobs Module.
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
        opportunities={opportunities.map((o) => ({
          id: o.id,
          label: `${o.title}${o.country ? ` (${o.country})` : ""}`,
        }))}
        lockedCustomer={
          lockedCustomer ? { id: lockedCustomer.id, label: lockedCustomer.fullName } : undefined
        }
        defaultValues={{ leadId }}
      />
    </div>
  );
}

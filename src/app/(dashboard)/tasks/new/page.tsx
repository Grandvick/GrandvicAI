import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listCustomers } from "@/lib/business/customers";
import { listLeads } from "@/lib/business/leads";
import { createTaskAction } from "../actions";
import { TaskForm } from "./TaskForm";

export const dynamic = "force-dynamic";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; leadId?: string }>;
}) {
  const { customerId, leadId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [customers, leads] = await Promise.all([
    listCustomers(supabase, businessId, {}),
    listLeads(supabase, businessId, {}),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New task</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a follow-up, reminder, or action item — optionally linked to a customer or lead.
        </p>
      </div>
      <TaskForm
        action={createTaskAction}
        submitLabel="Create task"
        customers={customers.map((c) => ({ id: c.id, fullName: c.fullName }))}
        leads={leads.map((l) => ({
          id: l.id,
          label: `${l.customerName}${l.service ? ` — ${l.service}` : ""}`,
        }))}
        defaultValues={{ relatedCustomerId: customerId, relatedLeadId: leadId }}
      />
    </div>
  );
}

import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listCustomers } from "@/lib/business/customers";
import { listPipelineStages } from "@/lib/business/pipeline-stages";
import { createLeadAction } from "../actions";
import { LeadForm } from "./LeadForm";

export const dynamic = "force-dynamic";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [customers, stages] = await Promise.all([
    listCustomers(supabase, businessId, {}),
    listPipelineStages(supabase, businessId),
  ]);

  const lockedCustomer = customerId ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New lead</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track a customer through the sales pipeline from first contact to close.
        </p>
      </div>
      <LeadForm
        action={createLeadAction}
        submitLabel="Create lead"
        customers={customers.map((c) => ({ id: c.id, fullName: c.fullName }))}
        stages={stages}
        lockedCustomer={
          lockedCustomer ? { id: lockedCustomer.id, fullName: lockedCustomer.fullName } : undefined
        }
      />
    </div>
  );
}

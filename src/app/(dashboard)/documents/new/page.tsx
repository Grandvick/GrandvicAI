import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listCustomers } from "@/lib/business/customers";
import { createDocumentRequestAction } from "../actions";
import { DocumentRequestForm } from "./DocumentRequestForm";

export const dynamic = "force-dynamic";

export default async function NewDocumentRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);
  const customers = await listCustomers(supabase, businessId, {});
  const lockedCustomer = customerId ? customers.find((c) => c.id === customerId) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Request a document</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ask a customer for a document — upload it here once it&rsquo;s ready for review.
        </p>
      </div>
      <DocumentRequestForm
        action={createDocumentRequestAction}
        submitLabel="Request document"
        customers={customers.map((c) => ({ id: c.id, fullName: c.fullName }))}
        lockedCustomer={
          lockedCustomer ? { id: lockedCustomer.id, fullName: lockedCustomer.fullName } : undefined
        }
      />
    </div>
  );
}

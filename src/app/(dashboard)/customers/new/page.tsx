import { createCustomerAction } from "../actions";
import { CustomerForm } from "./CustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">New customer</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a customer profile. You can add leads, tasks, and documents once they&rsquo;re saved.
        </p>
      </div>
      <CustomerForm action={createCustomerAction} submitLabel="Create customer" />
    </div>
  );
}

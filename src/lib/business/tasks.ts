import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskInput } from "./validation";
import { logActivity } from "./audit";

export type TaskItem = {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "pending" | "in_progress" | "done" | "cancelled";
  dueDate: string | null;
  ownerName: string | null;
  relatedCustomerId: string | null;
  relatedCustomerName: string | null;
  relatedLeadId: string | null;
  notes: string | null;
  createdAt: string;
};

const TASK_SELECT =
  "id, title, description, priority, status, due_date, notes, created_at, owner:owner_id (full_name), related_customer_id, related_lead_id, customers:related_customer_id (full_name)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTask(row: any): TaskItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date,
    ownerName: row.owner?.full_name ?? null,
    relatedCustomerId: row.related_customer_id,
    relatedCustomerName: row.customers?.full_name ?? null,
    relatedLeadId: row.related_lead_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function listTasks(
  supabase: SupabaseClient,
  businessId: string,
  opts: { status?: string; relatedCustomerId?: string; relatedLeadId?: string } = {}
): Promise<TaskItem[]> {
  let query = supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("business_id", businessId)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (opts.status) query = query.eq("status", opts.status);
  if (opts.relatedCustomerId) query = query.eq("related_customer_id", opts.relatedCustomerId);
  if (opts.relatedLeadId) query = query.eq("related_lead_id", opts.relatedLeadId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapTask);
}

export async function createTask(
  supabase: SupabaseClient,
  businessId: string,
  ownerId: string,
  input: TaskInput
): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      business_id: businessId,
      title: input.title,
      description: input.description || null,
      owner_id: ownerId,
      due_date: input.dueDate || null,
      priority: input.priority,
      status: input.status,
      related_customer_id: input.relatedCustomerId || null,
      related_lead_id: input.relatedLeadId || null,
      related_opportunity_id: input.relatedOpportunityId || null,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error) throw error;

  await logActivity(supabase, {
    businessId,
    actorId: ownerId,
    action: "task.created",
    objectType: "task",
    objectId: data.id as string,
  });

  return data.id as string;
}

export async function updateTaskStatus(
  supabase: SupabaseClient,
  taskId: string,
  updatedBy: string,
  status: TaskItem["status"]
): Promise<void> {
  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("business_id")
    .eq("id", taskId)
    .single();
  if (fetchError) throw fetchError;

  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) throw error;

  await logActivity(supabase, {
    businessId: task.business_id as string,
    actorId: updatedBy,
    action: "task.status_changed",
    objectType: "task",
    objectId: taskId,
    metadata: { status },
  });
}

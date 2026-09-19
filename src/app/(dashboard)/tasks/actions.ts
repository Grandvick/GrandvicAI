"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { taskSchema } from "@/lib/business/validation";
import { createTask, updateTaskStatus, type TaskItem } from "@/lib/business/tasks";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

function readTaskForm(formData: FormData) {
  return {
    title: String(formData.get("title") || ""),
    description: String(formData.get("description") || ""),
    dueDate: String(formData.get("dueDate") || ""),
    priority: String(formData.get("priority") || "medium"),
    status: String(formData.get("status") || "pending"),
    relatedCustomerId: String(formData.get("relatedCustomerId") || ""),
    relatedLeadId: String(formData.get("relatedLeadId") || ""),
    notes: String(formData.get("notes") || ""),
  };
}

export async function createTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = taskSchema.safeParse(readTaskForm(formData));
  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const { supabase, user } = await requireCurrentUser();
  let businessId: string;
  try {
    businessId = await resolveBusinessId(supabase, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not determine business." };
  }

  try {
    await createTask(supabase, businessId, user.userId, parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create task." };
  }

  revalidatePath("/tasks");
  redirect("/tasks");
}

/** Called directly from the tasks list's inline status dropdown (no form). */
export async function updateTaskStatusAction(
  taskId: string,
  status: TaskItem["status"]
): Promise<{ error?: string }> {
  const { supabase, user } = await requireCurrentUser();

  try {
    await updateTaskStatus(supabase, taskId, user.userId, status);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update task." };
  }

  revalidatePath("/tasks");
  return {};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatten(error: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues ?? []) {
    const key = issue.path[0];
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

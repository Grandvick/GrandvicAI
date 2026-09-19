import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardOverview = {
  newLeads: number;
  hotLeads: number;
  warmLeads: number;
  followUpsDue: number;
  activeApplications: number;
  pendingDocuments: number;
  paymentsDue: number;
  contentAwaitingApproval: number;
  scheduledPosts: number;
};

const EMPTY_OVERVIEW: DashboardOverview = {
  newLeads: 0,
  hotLeads: 0,
  warmLeads: 0,
  followUpsDue: 0,
  activeApplications: 0,
  pendingDocuments: 0,
  paymentsDue: 0,
  contentAwaitingApproval: 0,
  scheduledPosts: 0,
};

/**
 * Aggregates the "Today's Overview" numbers shown on the dashboard home
 * page (spec section 7). Returns zeros (rather than throwing) if the
 * database migration hasn't been run yet, so a fresh checkout never shows a
 * broken dashboard — just an empty one.
 *
 * Definitions here are a reasonable starting point and are expected to be
 * refined with the business owner once Phase 1 (CRM) and Phase 9
 * (Analytics) are built — see DEVELOPMENT_PROGRESS.md.
 */
export async function getDashboardOverview(
  supabase: SupabaseClient
): Promise<{ data: DashboardOverview; error: string | null }> {
  try {
    const [
      newLeads,
      hotLeads,
      warmLeads,
      followUpsDue,
      activeApplications,
      pendingDocuments,
      paymentsDue,
      contentAwaitingApproval,
      scheduledPosts,
    ] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "new"),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("temperature", "hot"),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("temperature", "warm"),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("due_date", new Date().toISOString()),
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .in("status", ["submitted", "under_review", "interview"]),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .in("status", ["uploaded", "pending_review"]),
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("status", ["requested", "pending"]),
      supabase
        .from("content")
        .select("id", { count: "exact", head: true })
        .eq("status", "awaiting_approval"),
      supabase
        .from("content_calendar")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled"),
    ]);

    return {
      data: {
        newLeads: newLeads.count ?? 0,
        hotLeads: hotLeads.count ?? 0,
        warmLeads: warmLeads.count ?? 0,
        followUpsDue: followUpsDue.count ?? 0,
        activeApplications: activeApplications.count ?? 0,
        pendingDocuments: pendingDocuments.count ?? 0,
        paymentsDue: paymentsDue.count ?? 0,
        contentAwaitingApproval: contentAwaitingApproval.count ?? 0,
        scheduledPosts: scheduledPosts.count ?? 0,
      },
      error: null,
    };
  } catch {
    return {
      data: EMPTY_OVERVIEW,
      error:
        "Could not read business data yet. Run the migration in supabase/migrations against your project — see SETUP.md.",
    };
  }
}

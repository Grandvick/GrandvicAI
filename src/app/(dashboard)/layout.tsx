import { env } from "@/lib/config";
import { NotConfigured } from "@/components/setup/NotConfigured";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listNotifications, countUnreadNotifications, type NotificationRow } from "@/lib/business/notifications";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Topbar } from "@/components/dashboard/Topbar";

// Every dashboard page depends on the signed-in user's session and live
// database state, so none of it should ever be statically prerendered
// (and prerendering would fail at build time on a machine with no
// .env.local yet, since Supabase wouldn't be configured).
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/">) {
  if (!env.hasSupabase) {
    return <NotConfigured />;
  }

  // requireCurrentUser() redirects to /login when there's no session, so
  // `user` is always populated below.
  const { supabase, user } = await requireCurrentUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("businesses:business_id (name)")
    .eq("id", user.userId)
    .maybeSingle();

  const businessName =
    (profile as { businesses?: { name?: string } | null } | null)?.businesses?.name ??
    "Grandvic Tours & Travel";

  // A brand-new staff account with no business assigned yet can't resolve a
  // business_id — show an empty bell rather than failing the whole layout.
  let notifications: NotificationRow[] = [];
  let unreadCount = 0;
  try {
    const businessId = await resolveBusinessId(supabase, user);
    [notifications, unreadCount] = await Promise.all([
      listNotifications(supabase, businessId, { limit: 8 }),
      countUnreadNotifications(supabase, businessId),
    ]);
  } catch {
    // Intentionally swallowed — see comment above.
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar businessName={businessName} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar
          userEmail={user.email}
          roleName={user.roleName}
          notifications={notifications}
          unreadCount={unreadCount}
        />
        <main className="flex-1 bg-slate-50 p-6">{children}</main>
      </div>
    </div>
  );
}

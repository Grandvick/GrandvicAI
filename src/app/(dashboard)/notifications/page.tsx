import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listNotifications } from "@/lib/business/notifications";
import { Badge } from "@/components/ui/badge";
import { MarkAllReadButton } from "./MarkAllReadButton";

export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<string, "slate" | "warm" | "hot" | "danger"> = {
  normal: "slate",
  important: "warm",
  high_priority: "hot",
  critical: "danger",
};

export default async function NotificationsPage() {
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);
  const notifications = await listNotifications(supabase, businessId, { limit: 100 });
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            {unreadCount} unread of {notifications.length}
          </p>
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {notifications.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No notifications yet.</p>
        ) : (
          <ul>
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`flex items-start justify-between gap-3 border-b border-slate-50 px-5 py-3 last:border-0 ${
                  n.isRead ? "" : "bg-slate-50/60"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{n.title}</p>
                    <Badge tone={LEVEL_TONE[n.level] ?? "slate"}>{n.level.replace("_", " ")}</Badge>
                  </div>
                  {n.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

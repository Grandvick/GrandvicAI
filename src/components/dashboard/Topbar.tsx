import { logout } from "@/app/login/actions";
import { NotificationsBell } from "./NotificationsBell";
import type { NotificationRow } from "@/lib/business/notifications";

export function Topbar({
  userEmail,
  roleName,
  notifications,
  unreadCount,
}: {
  userEmail: string;
  roleName: string;
  notifications: NotificationRow[];
  unreadCount: number;
}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div className="md:hidden text-sm font-semibold text-slate-900">Grandvic AI</div>
      <div className="hidden text-sm text-slate-500 md:block">
        Welcome back 👋
      </div>
      <div className="flex items-center gap-4">
        <NotificationsBell notifications={notifications} unreadCount={unreadCount} />
        <div className="text-right">
          <p className="text-sm font-medium text-slate-900">{userEmail}</p>
          <p className="text-xs text-slate-500">{roleName}</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

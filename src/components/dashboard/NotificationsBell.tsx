"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/app/(dashboard)/notifications/actions";
import type { NotificationRow } from "@/lib/business/notifications";

const LEVEL_DOT: Record<NotificationRow["level"], string> = {
  normal: "bg-slate-300",
  important: "bg-amber-400",
  high_priority: "bg-orange-500",
  critical: "bg-red-500",
};

export function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationRow[];
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const [count, setCount] = useState(unreadCount);
  const [, startTransition] = useTransition();

  function onOpenNotification(id: string, isRead: boolean) {
    if (isRead) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setCount((c) => Math.max(0, c - 1));
    startTransition(async () => {
      await markNotificationReadAction(id);
    });
  }

  function onMarkAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setCount(0);
    startTransition(async () => {
      await markAllNotificationsReadAction();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100"
        aria-label="Notifications"
      >
        🔔
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              {count > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-xs font-medium text-slate-500 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No notifications yet.</p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onOpenNotification(n.id, n.isRead)}
                    className={`flex w-full items-start gap-2 border-b border-slate-50 px-4 py-2.5 text-left last:border-0 hover:bg-slate-50 ${
                      n.isRead ? "" : "bg-slate-50/60"
                    }`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[n.level]}`} />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                      {n.body && (
                        <span className="line-clamp-2 block text-xs text-slate-500">{n.body}</span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-center">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                View all notifications
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

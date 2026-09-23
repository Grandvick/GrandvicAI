import Link from "next/link";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { listInboxConversations, type InboxConversationListItem } from "@/lib/business/inbox";
import { listStaff } from "@/lib/business/staff";
import { Badge, temperatureTone } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Phase 5E — the unified inbox list view (Phase 5 plan, section G),
 * replacing the ComingSoon stub. Read-only: no takeover/reply/pause
 * actions here yet — the plan's implementation sequence (section L)
 * deliberately stages those into Phase 5J, after a real outbound provider
 * (5G) exists to send a staff reply through. Shipped against the existing
 * website/dashboard-channel conversations first, exactly as the plan
 * recommends, so this view is useful before WhatsApp is wired to a real
 * webhook.
 */

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  website: "Website",
  dashboard: "Internal (AI Assistant)",
  facebook: "Facebook",
  instagram: "Instagram",
  email: "Email",
};

const CHANNEL_ICON: Record<string, string> = {
  whatsapp: "📱",
  website: "💬",
  dashboard: "🤖",
  facebook: "📘",
  instagram: "📸",
  email: "✉️",
};

const MODE_LABEL: Record<string, string> = {
  ai: "AI active",
  human: "Human active",
  paused: "AI paused",
};

function modeTone(mode: string): "good" | "info" | "warm" {
  if (mode === "human") return "info";
  if (mode === "paused") return "warm";
  return "good";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function displayName(item: InboxConversationListItem): string {
  if (item.customerName) return item.customerName;
  if (item.customerPhone) return item.customerPhone;
  return "Unknown contact";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; mode?: string; assignedTo?: string; needsReply?: string }>;
}) {
  const { channel, mode, assignedTo, needsReply } = await searchParams;
  const { supabase, user } = await requireCurrentUser();
  const businessId = await resolveBusinessId(supabase, user);

  const [conversations, staff] = await Promise.all([
    listInboxConversations(supabase, businessId, {
      channel: channel || undefined,
      mode: mode === "ai" || mode === "human" || mode === "paused" ? mode : undefined,
      assignedTo: assignedTo || undefined,
      needsReplyOnly: needsReply === "1",
    }),
    listStaff(supabase, businessId),
  ]);

  const baseQuery: Record<string, string> = {};
  if (channel) baseQuery.channel = channel;
  if (mode) baseQuery.mode = mode;
  if (assignedTo) baseQuery.assignedTo = assignedTo;
  if (needsReply) baseQuery.needsReply = needsReply;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          {conversations.length} conversation{conversations.length === 1 ? "" : "s"} — every customer
          conversation across every channel, in one place.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500" htmlFor="channel">
            Channel
          </label>
          <select
            id="channel"
            name="channel"
            defaultValue={channel ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All channels</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="website">Website</option>
            <option value="dashboard">Internal (AI Assistant)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500" htmlFor="mode">
            Mode
          </label>
          <select
            id="mode"
            name="mode"
            defaultValue={mode ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All modes</option>
            <option value="ai">AI active</option>
            <option value="human">Human active</option>
            <option value="paused">AI paused</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500" htmlFor="assignedTo">
            Assigned to
          </label>
          <select
            id="assignedTo"
            name="assignedTo"
            defaultValue={assignedTo ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Anyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
          <input type="checkbox" name="needsReply" value="1" defaultChecked={needsReply === "1"} />
          Needs a reply
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Filter
        </button>
        {(channel || mode || assignedTo || needsReply) && (
          <Link href="/inbox" className="px-2 py-2 text-sm text-slate-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {conversations.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No conversations match these filters.</p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.id} className="border-b border-slate-50 last:border-0">
                <Link
                  href={`/inbox/${c.id}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 ${
                    c.needsReply ? "bg-amber-50/40" : ""
                  }`}
                >
                  <span className="text-xl" title={CHANNEL_LABEL[c.channel] ?? c.channel}>
                    {CHANNEL_ICON[c.channel] ?? "💬"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{displayName(c)}</span>
                      {c.needsReply && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Needs a reply" />
                      )}
                      {c.leadTemperature && <Badge tone={temperatureTone(c.leadTemperature)}>{c.leadTemperature}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {c.lastMessageSenderType === "customer" ? "" : c.lastMessageSenderType === "ai" ? "AI: " : c.lastMessageSenderType === "staff" ? "You: " : ""}
                      {c.lastMessagePreview ?? "No messages yet."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <Badge tone={modeTone(c.mode)}>{MODE_LABEL[c.mode]}</Badge>
                    <span className="text-xs text-slate-400">{timeAgo(c.lastMessageAt)}</span>
                    {c.assignedToName && <span className="text-xs text-slate-400">{c.assignedToName}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

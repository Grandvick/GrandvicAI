import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/business/context";
import { getConversationState, listConversationMessages } from "@/lib/business/conversations";
import { buildConversationPublicState } from "@/lib/business/conversation-public-state";
import { listConversationEvents } from "@/lib/business/conversation-events";
import { getCustomer } from "@/lib/business/customers";
import { Badge, temperatureTone, formatStatusLabel } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Phase 5E — the unified inbox detail view (Phase 5 plan, section G).
 * Read-only, same as the list view: the transcript (listConversationMessages,
 * reused exactly as the website-channel test panel already uses it) and the
 * same structured state buildConversationPublicState already computes for
 * that panel and for the WhatsApp orchestration layer (Phase 5D) — this
 * page is simply a THIRD consumer of data the engine already produces, not
 * new business logic. Staff actions (take over/hand back/pause/reply-as-
 * staff) are Phase 5J per the plan's implementation sequence (section L) —
 * deliberately not built here.
 */

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  website: "Website",
  dashboard: "Internal (AI Assistant)",
  facebook: "Facebook",
  instagram: "Instagram",
  email: "Email",
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

const SENDER_LABEL: Record<string, string> = {
  customer: "Customer",
  ai: "AI",
  staff: "Staff",
};

export default async function InboxConversationDetailPage({ params }: PageProps<"/inbox/[conversationId]">) {
  const { conversationId } = await params;
  const { supabase } = await requireCurrentUser();

  const conversation = await getConversationState(supabase, conversationId);
  if (!conversation) notFound();

  const [messages, publicState, events, customer] = await Promise.all([
    listConversationMessages(supabase, conversationId, { limit: 100 }),
    buildConversationPublicState(supabase, conversation),
    listConversationEvents(supabase, conversationId, { limit: 20 }),
    conversation.customerId ? getCustomer(supabase, conversation.customerId) : Promise.resolve(null),
  ]);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <Link href="/inbox" className="text-sm text-slate-500 hover:underline">
            ← Inbox
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            {customer?.fullName ?? customer?.phone ?? "Unknown contact"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {CHANNEL_LABEL[conversation.channel] ?? conversation.channel}
            {customer?.phone ? ` · ${customer.phone}` : ""}
          </p>
        </div>
        <Badge tone={modeTone(conversation.mode)}>{MODE_LABEL[conversation.mode]}</Badge>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No messages in this conversation yet.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.senderType === "customer" ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap ${
                      m.senderType === "customer"
                        ? "bg-slate-100 text-slate-900"
                        : m.senderType === "staff"
                          ? "bg-slate-900 text-white"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-900"
                    }`}
                  >
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-60">
                      {SENDER_LABEL[m.senderType] ?? m.senderType}
                    </div>
                    {m.content}
                    <div className="mt-1 text-[10px] opacity-50">{new Date(m.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto lg:flex">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation state</h3>
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Intent</span>
                <span className="font-medium text-slate-700">
                  {publicState.intent ? formatStatusLabel(publicState.intent) : "—"}
                </span>
              </div>
              {publicState.leadId && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Lead</span>
                  <Link href={`/leads/${publicState.leadId}`} className="font-medium text-slate-700 underline">
                    {publicState.leadTemperature ? (
                      <Badge tone={temperatureTone(publicState.leadTemperature)}>
                        {publicState.leadTemperature} · {publicState.leadScore}
                      </Badge>
                    ) : (
                      "View lead"
                    )}
                  </Link>
                </div>
              )}
              {publicState.matchedOpportunityId && (
                <div>
                  <span className="text-slate-500">Matched job</span>
                  <Link
                    href={`/jobs/${publicState.matchedOpportunityId}`}
                    className="mt-1 block truncate font-medium text-slate-700 underline"
                  >
                    {publicState.matchedOpportunityTitle ?? "View job"}
                  </Link>
                </div>
              )}
              {publicState.handoverReason && (
                <div>
                  <span className="text-slate-500">Handover reason</span>
                  <p className="mt-1 text-xs text-slate-600">{publicState.handoverReason}</p>
                </div>
              )}
              {Object.keys(publicState.qualification).length > 0 && (
                <div>
                  <span className="text-slate-500">Qualification captured</span>
                  <ul className="mt-1 space-y-1">
                    {Object.entries(publicState.qualification).map(([k, v]) => (
                      <li key={k} className="text-xs text-slate-600">
                        <span className="font-medium">{formatStatusLabel(k)}:</span> {String(v)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
                Take over / hand back / reply as staff aren&rsquo;t available from the inbox yet — use the AI Sales
                Agent test tab&rsquo;s takeover controls for now.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent conversation events</h3>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">Nothing recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">{formatStatusLabel(e.eventType)}</span>
                    <span className="ml-1 text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

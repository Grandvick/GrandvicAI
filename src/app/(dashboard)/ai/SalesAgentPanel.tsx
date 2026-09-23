"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, temperatureTone, formatStatusLabel } from "@/components/ui/badge";
import { takeOverConversationAction, resumeAiConversationAction, pauseAiConversationAction } from "./sales-agent-actions";

type ChatMessage = {
  id: string;
  role: "customer" | "ai" | "system";
  content: string;
  toolCalls?: { name: string; ok: boolean }[];
};

type ConversationEvent = { id: string; eventType: string; payload: Record<string, unknown>; createdAt: string };

type ConversationPanelState = {
  id: string;
  mode: "ai" | "human" | "paused";
  intent: string | null;
  leadId: string | null;
  leadTemperature: "hot" | "warm" | "nurture" | null;
  leadScore: number | null;
  leadStage: string | null;
  matchedOpportunityId: string | null;
  matchedOpportunityTitle: string | null;
  qualification: Record<string, unknown>;
  handoverReason: string | null;
} | null;

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

const MODE_LABEL: Record<string, string> = {
  ai: "AI active",
  human: "Human active",
  paused: "AI paused",
};

export function SalesAgentPanel({ examplePrompts }: { examplePrompts: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [state, setState] = useState<ConversationPanelState>(null);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setMessages((prev) => [...prev, { id: newId(), role: "customer", content: trimmed }]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/ai/sales-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId: conversationId ?? undefined }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "system", content: data?.error || "Something went wrong. Please try again." },
        ]);
        if (data?.conversationId) setConversationId(data.conversationId);
        return;
      }

      if (data.conversationId) setConversationId(data.conversationId);
      if (data.conversation) setState(data.conversation);
      if (data.events) setEvents(data.events);

      if (!data.aiResponded) {
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "system",
            content:
              data.reason === "human"
                ? "A staff member has taken over this conversation — the AI won't reply until it's handed back."
                : "The AI is currently paused on this conversation.",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "ai", content: data.reply as string, toolCalls: data.toolCalls },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "system", content: "Couldn't reach the server. Check your connection and try again." },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function onNewConversation() {
    setMessages([]);
    setConversationId(null);
    setState(null);
    setEvents([]);
    setInput("");
  }

  function runTakeoverAction(action: (id: string) => Promise<{ error?: string }>) {
    if (!conversationId) return;
    startTransition(async () => {
      const result = await action(conversationId);
      if (result.error) {
        setMessages((prev) => [...prev, { id: newId(), role: "system", content: result.error! }]);
        return;
      }
      // Re-sync local mode optimistically — next message (or a takeover
      // control) will reconcile with the server's actual state regardless.
      setState((prev) => (prev ? { ...prev, mode: action === resumeAiConversationAction ? "ai" : prev.mode } : prev));
    });
  }

  return (
    <div className="flex flex-1 gap-4 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">
              AI
            </span>
            Test as a customer
          </div>
          <button
            type="button"
            onClick={onNewConversation}
            disabled={messages.length === 0 && !conversationId}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New test conversation
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <p className="max-w-sm text-sm text-slate-500">
                Type messages here as if you were a customer or prospect — the AI Sales Agent will respond using
                the same tools and rules it would use on a real channel.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {examplePrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap ${
                  m.role === "customer"
                    ? "bg-slate-900 text-white"
                    : m.role === "system"
                      ? "border border-amber-200 bg-amber-50 text-amber-800"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {m.content}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-emerald-200 pt-2">
                    {m.toolCalls.map((t, i) => (
                      <span
                        key={`${t.name}-${i}`}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          t.ok ? "bg-white text-emerald-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        🔧 {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-400">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400" />
                </span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-slate-100 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Type as a test customer… (Enter to send, Shift+Enter for a new line)"
            disabled={isSending}
            className="max-h-32 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>

      <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto lg:flex">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Conversation state</h3>
          {!state ? (
            <p className="mt-2 text-sm text-slate-400">Send a message to start a test conversation.</p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Mode</span>
                <Badge tone={state.mode === "ai" ? "good" : state.mode === "human" ? "info" : "warm"}>
                  {MODE_LABEL[state.mode]}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Intent</span>
                <span className="font-medium text-slate-700">{state.intent ? formatStatusLabel(state.intent) : "—"}</span>
              </div>
              {state.leadId && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Lead</span>
                  <a href={`/leads/${state.leadId}`} className="font-medium text-slate-700 underline">
                    {state.leadTemperature ? (
                      <Badge tone={temperatureTone(state.leadTemperature)}>
                        {state.leadTemperature} · {state.leadScore}
                      </Badge>
                    ) : (
                      "View lead"
                    )}
                  </a>
                </div>
              )}
              {state.matchedOpportunityId && (
                <div>
                  <span className="text-slate-500">Matched job</span>
                  <a href={`/jobs/${state.matchedOpportunityId}`} className="mt-1 block truncate font-medium text-slate-700 underline">
                    {state.matchedOpportunityTitle ?? "View job"}
                  </a>
                </div>
              )}
              {Object.keys(state.qualification).length > 0 && (
                <div>
                  <span className="text-slate-500">Qualification captured</span>
                  <ul className="mt-1 space-y-1">
                    {Object.entries(state.qualification).map(([k, v]) => (
                      <li key={k} className="text-xs text-slate-600">
                        <span className="font-medium">{formatStatusLabel(k)}:</span> {String(v)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {state.mode !== "human" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => runTakeoverAction(takeOverConversationAction)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Take over
                  </button>
                )}
                {state.mode !== "ai" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => runTakeoverAction(resumeAiConversationAction)}
                    className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Resume AI
                  </button>
                )}
                {state.mode !== "paused" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => runTakeoverAction(pauseAiConversationAction)}
                    className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Pause AI
                  </button>
                )}
              </div>
            </div>
          )}
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
                  <span className="ml-1 text-slate-400">{new Date(e.createdAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

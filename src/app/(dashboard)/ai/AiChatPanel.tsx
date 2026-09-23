"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  toolCalls?: { name: string; ok: boolean }[];
};

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function AiChatPanel({
  examplePrompts,
  initialPrompt,
}: {
  examplePrompts: string[];
  initialPrompt: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [isSending, setIsSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = { id: newId(), role: "user", content: trimmed };
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history, conversationId: conversationId ?? undefined }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errorText = data?.error || "Something went wrong. Please try again.";
        setMessages((prev) => [...prev, { id: newId(), role: "error", content: errorText }]);
        if (data?.conversationId) setConversationId(data.conversationId);
        return;
      }

      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: data.reply as string, toolCalls: data.toolCalls },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "error", content: "Couldn't reach the server. Check your connection and try again." },
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
    setInput("");
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
            AI
          </span>
          Grandvic AI Assistant
        </div>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={messages.length === 0 && !conversationId}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          New conversation
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-sm text-sm text-slate-500">
              Ask about leads, jobs, applicants, documents, tasks, or today&rsquo;s business summary —
              answers come from your real data, using approved read-only tools only.
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
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-slate-900 text-white"
                  : m.role === "error"
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "border border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              {m.content}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-200 pt-2">
                  {m.toolCalls.map((t, i) => (
                    <span
                      key={`${t.name}-${i}`}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        t.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}
                      title={t.ok ? "Tool call succeeded" : "Tool call failed"}
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
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-400">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
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
          placeholder="Ask about your business… (Enter to send, Shift+Enter for a new line)"
          disabled={isSending}
          className="max-h-32 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

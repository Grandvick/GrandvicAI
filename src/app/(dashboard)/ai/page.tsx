import Link from "next/link";
import { env } from "@/lib/config";
import { requireCurrentUser, resolveBusinessId } from "@/lib/business/context";
import { AiChatPanel } from "./AiChatPanel";
import { SalesAgentPanel } from "./SalesAgentPanel";
import { WhatsAppSimulatorPanel } from "./WhatsAppSimulatorPanel";

export const dynamic = "force-dynamic";

const EXAMPLE_PROMPTS = [
  "Show me my hot leads.",
  "What jobs are currently open?",
  "Which applicants are missing documents?",
  "Give me today's business summary.",
  "Show me recent recruitment activity.",
  "How many applications are currently under review?",
  "Which customers have active applications?",
];

// Phase 4 spec section 19's acceptance-test prompts — a good "type as a
// customer" starting point for the Sales Agent simulator.
const SALES_AGENT_EXAMPLE_PROMPTS = [
  "Hi, I want to work abroad.",
  "I am a physiotherapist and I'm interested in Somalia.",
  "What documents do I need for this job?",
  "Do you have any tours to the coast?",
  "I'd like to speak to a person, please.",
];

export default async function AiCommandCentrePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>;
}) {
  const { q, tab } = await searchParams;
  const activeTab = tab === "agent" ? "agent" : tab === "whatsapp" ? "whatsapp" : "assistant";

  // hasAiProvider (not hasOpenAI directly) so both tabs work with
  // AI_PROVIDER=mock even without an OpenAI key at all (Phase 4 dev/test
  // mode — see SETUP.md section 3b and src/lib/config.ts).
  if (!env.hasAiProvider) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">
            🤖
          </div>
          <h1 className="text-lg font-semibold text-slate-900">AI Command Centre isn&rsquo;t configured yet</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Add <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">OPENAI_API_KEY</code> (and
            optionally <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">OPENAI_MODEL</code>) to
            your environment — see SETUP.md. Every other part of the AI Core (tools, logging,
            conversation history) is already built and ready as soon as a key is added.
          </p>
        </div>
      </div>
    );
  }

  // requireCurrentUser() redirects to /login if signed out; resolveBusinessId
  // throws a clear, catchable error for an account with no business context
  // yet (e.g. brand-new staff with no assignment) — same pattern as every
  // other (dashboard) page, never assumes profile.business_id is populated.
  const { supabase, user } = await requireCurrentUser();
  let businessName = "your business";
  let contextError: string | null = null;
  try {
    const businessId = await resolveBusinessId(supabase, user);
    const { data: business } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
    businessName = (business?.name as string | undefined) ?? businessName;
  } catch {
    contextError = user.isOwner
      ? "No business exists yet. Create one first (see Settings)."
      : "Your account isn't assigned to a business yet. Ask the owner to assign one in Settings.";
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">AI Command Centre</h1>
        <p className="mt-1 text-sm text-slate-500">
          {activeTab === "assistant"
            ? `Ask about real data in ${businessName} — the assistant answers using approved tools against your live database, never invented data.`
            : activeTab === "agent"
              ? `Try the AI Sales Agent as if you were a customer of ${businessName} — same rules, same real data, no real channel connected yet (Phase 5).`
              : `Simulate an inbound WhatsApp message to ${businessName} — same AI Sales Agent engine as the tab above, routed through the WhatsApp channel adapter (mock sending only — no real Meta connection yet).`}
        </p>
        <div className="mt-4 flex gap-1 border-b border-slate-200">
          <Link
            href="/ai"
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              activeTab === "assistant"
                ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Ask Grandvic AI
          </Link>
          <Link
            href="/ai?tab=agent"
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              activeTab === "agent"
                ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            AI Sales Agent (test)
          </Link>
          <Link
            href="/ai?tab=whatsapp"
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              activeTab === "whatsapp"
                ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            WhatsApp (simulated)
          </Link>
        </div>
      </div>

      {contextError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          {contextError}
        </div>
      ) : activeTab === "agent" ? (
        <SalesAgentPanel examplePrompts={SALES_AGENT_EXAMPLE_PROMPTS} />
      ) : activeTab === "whatsapp" ? (
        <WhatsAppSimulatorPanel />
      ) : (
        <AiChatPanel examplePrompts={EXAMPLE_PROMPTS} initialPrompt={q ?? ""} />
      )}
    </div>
  );
}

import { env } from "@/lib/config";

function StatusRow({
  name,
  configured,
  phase,
  note,
}: {
  name: string;
  configured: boolean;
  phase: number;
  note: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-900">{name}</p>
        <p className="text-xs text-slate-500">{note}</p>
      </div>
      <div className="text-right">
        <span
          className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${
            configured
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {configured ? "Environment variable set" : "Not configured"}
        </span>
        {!configured && (
          <p className="mt-1 text-[11px] text-slate-400">Needed from Phase {phase}</p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Full business, AI, notification and integration settings screens are built
          progressively (spec section 35). This page shows what&rsquo;s wired up so far.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Integration status</h2>
        <p className="mb-2 text-xs text-slate-500">
          &ldquo;Environment variable set&rdquo; means the key exists in your .env.local file —
          it does not yet mean the connection has been tested end-to-end. We&rsquo;ll only ever
          tell you an integration is fully working once it has actually been exercised.
        </p>
        <StatusRow
          name="Supabase (database + auth)"
          configured={env.hasSupabase}
          phase={0}
          note="Required for login, the CRM and every other data-backed feature."
        />
        <StatusRow
          name="OpenAI (AI Core)"
          configured={env.hasOpenAI}
          phase={3}
          note="Powers the AI assistant, lead qualification and content generation."
        />
        <StatusRow
          name="WhatsApp Business Platform"
          configured={env.hasWhatsApp}
          phase={5}
          note="Primary customer communication channel and owner notification channel."
        />
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
        Business profile, brand assets, lead scoring rules, follow-up rules and
        automation permissions will each get their own settings panel as their
        phase is built — see DEVELOPMENT_PROGRESS.md.
      </div>
    </div>
  );
}

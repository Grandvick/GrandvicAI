export function NotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
          ⚙️ Setup required
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          Grandvic AI isn&rsquo;t connected to a database yet
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This app needs a Supabase project before it can show real data or let
          you log in. This only takes a few minutes:
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
          <li>
            Create a free project at{" "}
            <span className="font-medium">supabase.com</span>.
          </li>
          <li>
            Copy <code className="rounded bg-slate-100 px-1 py-0.5">.env.example</code>{" "}
            to <code className="rounded bg-slate-100 px-1 py-0.5">.env.local</code> in
            the project folder.
          </li>
          <li>
            Paste your Project URL and anon key from Supabase&rsquo;s{" "}
            <span className="font-medium">Project Settings → API</span> page.
          </li>
          <li>Run the SQL in this project&rsquo;s SETUP.md against your new project.</li>
          <li>Restart the app.</li>
        </ol>
        <p className="mt-4 text-xs text-slate-500">
          Full step-by-step instructions, including screenshots-free
          copy/paste commands for Windows, are in{" "}
          <span className="font-mono">SETUP.md</span>.
        </p>
      </div>
    </div>
  );
}

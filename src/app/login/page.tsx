import { env } from "@/lib/config";
import { NotConfigured } from "@/components/setup/NotConfigured";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  if (!env.hasSupabase) {
    return <NotConfigured />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white font-semibold">
            G
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Grandvic AI</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to your business dashboard
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-slate-400">
          No account yet? Create the first (owner) account directly in your
          Supabase project&rsquo;s Authentication tab — see SETUP.md.
        </p>
      </div>
    </div>
  );
}

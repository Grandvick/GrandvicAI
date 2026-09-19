import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";
import { env } from "@/lib/config";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Reads/writes the auth session via Next.js's cookies() API.
 *
 * `cookies()` is async in this Next.js version, so this factory is async too
 * — always `await createSupabaseServerClient()`.
 */
export async function createSupabaseServerClient() {
  if (!env.hasSupabase) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See SETUP.md."
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.supabaseUrl as string,
    env.supabaseAnonKey as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component where cookies can't be set.
            // Safe to ignore as long as the proxy (src/proxy.ts) is
            // refreshing the session on every request.
          }
        },
      },
    }
  );
}

/**
 * Service-role client for trusted server-only operations that must bypass
 * Row Level Security (e.g. scheduled jobs, webhook handlers verifying
 * external events). NEVER import this into a Client Component and NEVER
 * expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export async function createSupabaseServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Service role client requested but NEXT_PUBLIC_SUPABASE_URL or " +
        "SUPABASE_SERVICE_ROLE_KEY is missing from the environment."
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  return createClient<Database>(env.supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { env } from "@/lib/config";

/**
 * Supabase client for use in Client Components ("use client" files).
 * Reads the session from cookies so it stays in sync with the server.
 *
 * Throws a clear error (instead of a confusing Supabase SDK error) if the
 * project has not been configured yet — see .env.example / SETUP.md.
 */
export function createClient() {
  if (!env.hasSupabase) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See SETUP.md."
    );
  }

  return createBrowserClient<Database>(
    env.supabaseUrl as string,
    env.supabaseAnonKey as string
  );
}

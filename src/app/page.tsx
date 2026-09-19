import { redirect } from "next/navigation";
import { env } from "@/lib/config";
import { NotConfigured } from "@/components/setup/NotConfigured";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Always depends on the live session — never prerender/cache this route.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!env.hasSupabase) {
    return <NotConfigured />;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}

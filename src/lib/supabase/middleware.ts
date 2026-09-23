import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated visitors away from protected routes. Called from
 * src/proxy.ts (Next.js 16 renamed "middleware" to "proxy" — see
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 *
 * This performs only an "optimistic" check against the cookie-stored
 * session, per Next.js's authentication guide. Every server component /
 * route handler that touches real data still calls
 * createSupabaseServerClient() and must not rely on the proxy alone.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase isn't configured yet — let requests through untouched so the
  // rest of the app can show its own "not configured" screen rather than
  // the proxy throwing a hard-to-debug error on every route.
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login");
  const isPublicAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/webhooks/whatsapp") ||
    pathname === "/favicon.ico";

  if (!user && !isAuthRoute && !isPublicAsset && pathname !== "/") {
    const redirectUrl = new URL("/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

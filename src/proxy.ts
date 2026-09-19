import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 renamed "Middleware" to "Proxy" (same functionality, new file
 * name/export). This runs on every matched request, refreshes the Supabase
 * session, and redirects signed-out visitors away from protected routes.
 * See node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 */
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, and common static file extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

import { NextResponse } from "next/server";
import { env } from "@/lib/config";

/**
 * Basic health/status endpoint. Never returns secrets — only booleans
 * indicating which integrations are configured. Useful for confirming the
 * app is running and which env vars still need to be filled in.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    time: new Date().toISOString(),
    integrations: {
      supabase: env.hasSupabase,
      openai: env.hasOpenAI,
      whatsapp: env.hasWhatsApp,
    },
  });
}

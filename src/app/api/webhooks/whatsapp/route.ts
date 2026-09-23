import { NextResponse } from "next/server";
import { whatsAppWebhookConfig } from "@/lib/config";
import { verifyWebhookSignature } from "@/lib/channels/whatsapp/webhook-signature";
import { extractInboundTextMessages } from "@/lib/channels/whatsapp/webhook-payload";
import { recordWebhookEventOnce } from "@/lib/channels/whatsapp/webhook-events";
import { resolveWhatsAppBusinessId } from "@/lib/channels/whatsapp/business-accounts";
import { conversationMessageExternalIdExists } from "@/lib/business/conversations";
import { orchestrateInboundWhatsAppMessage } from "@/lib/channels/whatsapp/orchestrate";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Webhook-delivered, not session-dependent — but still never statically
// prerendered, matching every other API route in this app.
export const dynamic = "force-dynamic";

/**
 * The real inbound WhatsApp webhook route (Phase 5F — Phase 5 plan, section
 * F/I). This is the FIRST time anything in the app is reachable from the
 * public internet without a Supabase Auth session — every design choice
 * here follows directly from that: verify before touching a database,
 * never trust a business_id from the payload, never let a public caller's
 * mistake or Meta's own retry policy turn into a 5xx (which just causes
 * more retries) or an uncaught exception.
 *
 * GET handles Meta's one-time webhook subscription handshake
 * (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`). POST handles real inbound events,
 * authenticated per-request via the `X-Hub-Signature-256` HMAC
 * (`WHATSAPP_APP_SECRET`) — a completely different mechanism, see
 * webhook-signature.ts's doc comment.
 *
 * POST wires each extracted text message through the exact orchestration
 * layer Phase 5D already proved out (orchestrateInboundWhatsAppMessage) —
 * this route's only job is: authenticate, dedupe (two independent layers —
 * see webhook-events.ts and conversationMessageExternalIdExists), resolve
 * which business owns the number, and hand off. No AI/business logic lives
 * here.
 *
 * Deliberately NOT built here (see the Phase 5F report for the full list):
 * inbound media handling (images/voice notes/documents/location/interactive
 * replies — only `type: "text"` is processed, see webhook-payload.ts),
 * `statuses` delivery-receipt processing, and a durable (database/Redis-
 * backed) rate limiter (Phase 5 plan section I flags the existing in-memory
 * per-user limiter in src/lib/ai/rate-limit.ts as unsuitable for a webhook
 * with no user and no guaranteed single-instance memory — building its
 * replacement isn't listed in this stage's scope, section L). A payload-size
 * guard below is the one abuse-prevention measure section I asks for that
 * needs no new infrastructure.
 */

// A real single-message WhatsApp webhook payload is a few KB. 1MB is a
// generous ceiling, not a tight budget — section I: "reject payloads above
// a sane size before parsing."
const MAX_BODY_BYTES = 1_000_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!whatsAppWebhookConfig.verifyToken) {
    console.error("[whatsapp:webhook] GET verification requested but WHATSAPP_WEBHOOK_VERIFY_TOKEN isn't configured");
    return new NextResponse("WhatsApp webhook isn't configured yet.", { status: 503 });
  }

  // Meta expects the raw hub.challenge value echoed back as the response
  // body, unwrapped — never JSON, never any other transformation.
  if (mode === "subscribe" && challenge && token === whatsAppWebhookConfig.verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  // Read the RAW body before any parsing — HMAC is computed over exact
  // bytes (see webhook-signature.ts).
  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    console.error("[whatsapp:webhook] payload exceeds the size limit — rejected before parsing");
    return new NextResponse("Payload too large", { status: 413 });
  }

  if (!whatsAppWebhookConfig.appSecret) {
    console.error("[whatsapp:webhook] POST received but WHATSAPP_APP_SECRET isn't configured — refusing to process");
    return new NextResponse("WhatsApp webhook isn't configured yet.", { status: 503 });
  }

  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature, whatsAppWebhookConfig.appSecret)) {
    console.error("[whatsapp:webhook] invalid X-Hub-Signature-256 — request dropped before any database access");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[whatsapp:webhook] signature valid but body is not valid JSON");
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const messages = extractInboundTextMessages(payload);
  if (messages.length === 0) {
    // Nothing to process — e.g. a `statuses` (delivery/read receipt)
    // update, or a non-text message type this stage doesn't handle. Still
    // 200: Meta must not retry a payload this app understood but chose not
    // to act on.
    return NextResponse.json({ received: true });
  }

  const supabase = await createSupabaseServiceRoleClient();

  for (const message of messages) {
    try {
      // Layer 1 (event-level): insert-first, catch-the-conflict. If this
      // exact message id was already recorded, stop here — no further
      // side effects for it (the plan's "Z2: 200 OK immediately" node).
      const isNewEvent = await recordWebhookEventOnce(supabase, message.id, message);
      if (!isNewEvent) continue;

      // business_id ALWAYS comes from this lookup, never from anything
      // else in the payload — see business-accounts.ts's doc comment
      // (section I: "never trusted from the payload's free-text fields").
      const businessId = await resolveWhatsAppBusinessId(supabase, message.phoneNumberId);
      if (!businessId) {
        console.error(
          `[whatsapp:webhook] no active business mapped for phone_number_id ${message.phoneNumberId} — dropping message ${message.id}`
        );
        continue;
      }

      // Layer 2 (message-level), checked here — before any customer/
      // conversation resolution — rather than only relying on
      // appendConversationMessage's insert to hit the unique constraint:
      // this is strictly better than the plan's own flowchart ordering
      // (which checks after customer resolution), since it skips ALL work
      // for a confirmed duplicate rather than some of it, while still
      // serving the same purpose — defense in depth if Layer 1 were ever
      // bypassed (e.g. by a future refactor).
      const alreadyPersisted = await conversationMessageExternalIdExists(supabase, message.id);
      if (alreadyPersisted) continue;

      const result = await orchestrateInboundWhatsAppMessage({
        businessId,
        fromPhone: message.from,
        text: message.text,
        externalId: message.id,
      });

      if (!result.ok) {
        // Failure isolation (section F): orchestrateInboundWhatsAppMessage
        // only ever reaches ok:false AFTER persisting the inbound message,
        // so the one thing that matters (recording what the customer
        // said) already succeeded — logged here, never turned into a 5xx
        // to Meta, which would just cause a pointless retry.
        console.error(`[whatsapp:webhook] orchestration failed for message ${message.id}: ${result.error}`);
      }
    } catch (err) {
      // An unexpected failure processing ONE message (e.g. a transient
      // database error) must not stop the rest of the batch, and must
      // never become an uncaught exception that 500s the whole webhook
      // call — that would just make Meta retry the whole payload,
      // including messages already successfully processed above.
      console.error(`[whatsapp:webhook] unexpected error processing message ${message.id}`, err);
    }
  }

  return NextResponse.json({ received: true });
}

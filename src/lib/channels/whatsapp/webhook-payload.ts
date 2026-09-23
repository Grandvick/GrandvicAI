import "server-only";

/**
 * Phase 5F — parses Meta's WhatsApp Cloud API webhook envelope (Phase 5
 * plan, section F). This shape (`{object, entry: [{id, changes: [{value,
 * field}]}]}`, with `value.metadata.phone_number_id` and
 * `value.messages[]`/`value.statuses[]`) has been Meta's stable webhook
 * format for the WhatsApp Cloud API; it is NOT re-verified against Meta's
 * current developer docs as part of this implementation (per the Phase 5
 * plan's own "flag for verification against Meta's current developer docs
 * rather than stated from training data" rule for anything Meta-specific)
 * — this should be confirmed against a real payload (or Meta's docs) during
 * Phase 5H/5I's end-to-end testing, before production cutover.
 *
 * Deliberately permissive/defensive: a webhook payload is untrusted input
 * from the public internet (even once signature-verified, its exact shape
 * can still vary — Meta adds fields over time, sends non-text message
 * types, batches multiple messages, and sends status/delivery-receipt
 * updates through the same endpoint). Every field access below is
 * optional-chained; a payload that doesn't match the expected shape simply
 * yields zero extracted messages rather than throwing, so a webhook call
 * Meta considers valid never 500s this route.
 */

export type InboundWhatsAppTextMessage = {
  /** Meta's `phone_number_id` for the receiving number (routes to a business via whatsapp_business_accounts). */
  phoneNumberId: string;
  /** The sending customer's WhatsApp number (E.164-ish, no leading +). */
  from: string;
  /** The message's own id (Meta's `wamid`) — the idempotency key for both whatsapp_webhook_events and conversation_messages.external_id. */
  id: string;
  text: string;
};

/**
 * Only `type === "text"` messages are extracted — Phase 5F does not handle
 * inbound media (images, voice notes, documents, location, interactive
 * replies) or `statuses` (delivery/read receipt) entries; those are
 * silently skipped here rather than erroring, and the webhook route still
 * acknowledges the whole payload with 200 either way. See the Phase 5F
 * report for this deliberately deferred scope.
 */
export function extractInboundTextMessages(payload: unknown): InboundWhatsAppTextMessage[] {
  const messages: InboundWhatsAppTextMessage[] = [];

  if (!payload || typeof payload !== "object") return messages;
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return messages;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: unknown } | null)?.value as
        | {
            metadata?: { phone_number_id?: unknown };
            messages?: unknown;
          }
        | null
        | undefined;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (typeof phoneNumberId !== "string" || !phoneNumberId) continue;

      const rawMessages = value.messages;
      if (!Array.isArray(rawMessages)) continue; // e.g. a `statuses` update, not a message

      for (const raw of rawMessages) {
        const m = raw as {
          id?: unknown;
          from?: unknown;
          type?: unknown;
          text?: { body?: unknown };
        } | null;
        if (!m || m.type !== "text") continue;
        if (typeof m.id !== "string" || !m.id) continue;
        if (typeof m.from !== "string" || !m.from) continue;
        if (typeof m.text?.body !== "string" || !m.text.body) continue;

        messages.push({ phoneNumberId, from: m.from, id: m.id, text: m.text.body });
      }
    }
  }

  return messages;
}

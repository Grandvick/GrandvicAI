import "server-only";

/**
 * Phase 5B — the WhatsApp outbound adapter contract (Phase 5 plan, section
 * B/K). Deliberately mirrors src/lib/ai/types.ts's `AiProvider` shape: a
 * small interface + a factory (src/lib/channels/whatsapp/provider/index.ts)
 * so a real Graph API implementation can be added later (Phase 5G) without
 * any caller change, exactly the way OpenAiProvider/DevRuleBasedProvider
 * both implement `AiProvider` today.
 *
 * Nothing in this file, or anywhere under src/lib/channels/whatsapp/,
 * is imported by src/lib/ai/** — the AI Sales Agent stays channel-agnostic
 * (Phase 5 plan's core architectural principle). This module is only ever
 * imported by the future WhatsApp orchestration layer (Phase 5D) and the
 * webhook route (Phase 5F), neither of which exists yet.
 *
 * Shapes here are deliberately provider-agnostic (no Meta/Graph API field
 * names) for the same reason AiProviderTurn/AiProviderToolSchema are
 * provider-agnostic — only the real MetaWhatsAppProvider (Phase 5G) should
 * ever need to know what a Graph API request body looks like.
 */

/** What a send call returns — enough for the orchestration layer to record delivery without knowing which provider handled it. */
export type WhatsAppSendResult = {
  /**
   * The channel's own id for the sent message (Meta's `wamid` for the real
   * provider). Phase 5's `conversation_messages.external_id` column exists
   * to hold exactly this for an OUTBOUND row, the same way it holds an
   * inbound message's wamid for idempotency — see 0008_whatsapp_channel.sql.
   */
  externalId: string;
  status: "sent" | "queued" | "failed";
};

export type WhatsAppTextMessage = {
  /** Destination phone number. Callers pass it already normalized (see src/lib/business/customers.ts's normalizePhone) — this layer does not guess at formatting. */
  to: string;
  body: string;
};

export type WhatsAppTemplateMessage = {
  to: string;
  /** Must name a template already approved at Meta (Phase 5 plan, section C's `message_templates` cache) — this layer never invents or submits a template. */
  templateName: string;
  language: string;
  variables?: Record<string, string>;
};

export type WhatsAppMediaMessage = {
  to: string;
  /** Where the media currently lives (Supabase Storage signed URL or path — resolved by the caller, per the Phase 5 plan's security section: this layer never proxies Meta's own expiring media URLs). */
  mediaUrl: string;
  mimeType: string;
  caption?: string;
};

export type WhatsAppDocumentMessage = {
  to: string;
  mediaUrl: string;
  filename: string;
  mimeType: string;
  caption?: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  sendText(input: WhatsAppTextMessage): Promise<WhatsAppSendResult>;
  sendTemplate(input: WhatsAppTemplateMessage): Promise<WhatsAppSendResult>;
  sendMedia(input: WhatsAppMediaMessage): Promise<WhatsAppSendResult>;
  sendDocument(input: WhatsAppDocumentMessage): Promise<WhatsAppSendResult>;
}

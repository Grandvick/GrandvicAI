import "server-only";
import { WhatsAppSendError } from "../errors";
import type {
  WhatsAppDocumentMessage,
  WhatsAppMediaMessage,
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from "../types";

/**
 * Phase 5G — the real outbound WhatsApp provider: calls Meta's Graph API
 * (the WhatsApp Cloud API's `/messages` endpoint) instead of the in-memory
 * stand-in `MockWhatsAppProvider` (Phase 5B) implements. Selected by
 * `getWhatsAppProvider()` (./index.ts) whenever `WHATSAPP_PROVIDER` isn't
 * `"mock"`, and only once `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
 * `WHATSAPP_API_VERSION` are all configured (the factory checks this, not
 * this class — see index.ts).
 *
 * The `POST /{api-version}/{phone-number-id}/messages` request/response
 * shape used below (`messaging_product: "whatsapp"`, a `type` discriminator
 * with a same-named object key, a success response containing
 * `messages: [{ id }]`, an error response containing `error: { message,
 * code, ... }`) has been the WhatsApp Cloud API's stable wire format for
 * years and is basic REST mechanics, not a pricing/deprecation-prone
 * specific — but per the Phase 5 plan's own rule ("flag for verification
 * against Meta's current developer docs rather than stated from training
 * data" for anything Meta-specific), this has NOT been exercised against a
 * real Meta endpoint as part of this implementation. It should be verified
 * against a real send (Phase 5H/5I's end-to-end test with Meta's test
 * number) before this provider is ever pointed at production traffic.
 *
 * Every public method validates its own input BEFORE making a network
 * call — mirrors MockWhatsAppProvider's validation exactly, so a request
 * this app can already tell is malformed never reaches Meta, wastes a
 * quota unit, or produces a confusing Graph API error to parse.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "whatsapp-meta";

  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly apiVersion: string
  ) {}

  async sendText(input: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    requireTo(input.to, "sendText");
    if (!input.body.trim()) throw new WhatsAppSendError('sendText: "body" must not be empty.');
    return this.send("sendText", {
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: { body: input.body },
    });
  }

  async sendTemplate(input: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    requireTo(input.to, "sendTemplate");
    if (!input.templateName.trim()) throw new WhatsAppSendError('sendTemplate: "templateName" must not be empty.');
    if (!input.language.trim()) throw new WhatsAppSendError('sendTemplate: "language" must not be empty.');

    const variables = input.variables ? Object.values(input.variables) : [];
    return this.send("sendTemplate", {
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
        ...(variables.length > 0
          ? { components: [{ type: "body", parameters: variables.map((v) => ({ type: "text", text: v })) }] }
          : {}),
      },
    });
  }

  async sendMedia(input: WhatsAppMediaMessage): Promise<WhatsAppSendResult> {
    requireTo(input.to, "sendMedia");
    if (!input.mediaUrl.trim()) throw new WhatsAppSendError('sendMedia: "mediaUrl" must not be empty.');
    if (!input.mimeType.trim()) throw new WhatsAppSendError('sendMedia: "mimeType" must not be empty.');

    // WhatsAppMediaMessage (types.ts) carries a mimeType but no explicit
    // "kind" — the Graph API needs one of "image"/"video"/"audio" as both
    // the `type` field AND the object key the media details nest under, so
    // it's derived here from the mime type's prefix. Anything else (e.g. a
    // generic mimeType this doesn't recognize) is rejected with a clear
    // message pointing at sendDocument, rather than guessed at.
    const graphType = graphMediaTypeFor(input.mimeType);
    if (!graphType) {
      throw new WhatsAppSendError(
        `sendMedia: unsupported mimeType "${input.mimeType}" — only image/*, video/*, and audio/* can be sent via sendMedia; use sendDocument for other file types.`
      );
    }

    return this.send("sendMedia", {
      messaging_product: "whatsapp",
      to: input.to,
      type: graphType,
      [graphType]: { link: input.mediaUrl, ...(input.caption ? { caption: input.caption } : {}) },
    });
  }

  async sendDocument(input: WhatsAppDocumentMessage): Promise<WhatsAppSendResult> {
    requireTo(input.to, "sendDocument");
    if (!input.mediaUrl.trim()) throw new WhatsAppSendError('sendDocument: "mediaUrl" must not be empty.');
    if (!input.filename.trim()) throw new WhatsAppSendError('sendDocument: "filename" must not be empty.');

    return this.send("sendDocument", {
      messaging_product: "whatsapp",
      to: input.to,
      type: "document",
      document: {
        link: input.mediaUrl,
        filename: input.filename,
        ...(input.caption ? { caption: input.caption } : {}),
      },
    });
  }

  /** The one place that actually calls the Graph API — every public method above builds its own request body and hands it here. */
  private async send(fnName: string, body: Record<string, unknown>): Promise<WhatsAppSendResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new WhatsAppSendError(`${fnName}: could not reach the WhatsApp Cloud API.`, { cause: err });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new WhatsAppSendError(
        `${fnName}: the WhatsApp Cloud API returned a response that couldn't be read (HTTP ${response.status}).`,
        { cause: err }
      );
    }

    if (!response.ok) {
      throw new WhatsAppSendError(`${fnName}: WhatsApp Cloud API rejected the request — ${extractGraphErrorMessage(json, response.status)}`, {
        cause: json,
      });
    }

    const messageId = extractMessageId(json);
    if (!messageId) {
      throw new WhatsAppSendError(`${fnName}: WhatsApp Cloud API returned success but no message id.`, { cause: json });
    }

    return { externalId: messageId, status: "sent" };
  }
}

function requireTo(to: string, fnName: string): void {
  if (!to || !to.trim()) {
    throw new WhatsAppSendError(`${fnName}: "to" must not be empty.`);
  }
}

function graphMediaTypeFor(mimeType: string): "image" | "video" | "audio" | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

function extractGraphErrorMessage(json: unknown, httpStatus: number): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" && message ? message : `HTTP ${httpStatus}`;
}

function extractMessageId(json: unknown): string | null {
  const messages = (json as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const id = (messages[0] as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : null;
}

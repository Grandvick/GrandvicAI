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
 * Phase 5B — the WhatsApp analog of src/lib/ai/provider/dev-mock.ts's
 * `DevRuleBasedProvider`: a real, runtime-selectable provider (via
 * `WHATSAPP_PROVIDER=mock`, see ./index.ts), not a test-only stub. It never
 * makes a network call or imports the Meta Graph API — every send is logged
 * and recorded in-memory instead, so Phase 5D/5F/5J can be built and fully
 * exercised (including from the dashboard, once Phase 5D's simulator
 * exists) before any Meta credentials are configured, the same way
 * `AI_PROVIDER=mock` already lets the whole Sales Agent be tested without
 * an OpenAI key.
 *
 * Deliberately does NOT write to conversation_messages or touch Supabase —
 * persisting the AI's reply is the orchestration layer's job (Phase 5D),
 * exactly as it is today for the website channel (see
 * appendConversationMessage in src/app/api/ai/sales-agent/route.ts, which
 * runs regardless of which channel/provider is involved). Keeping this
 * provider free of any database import keeps it as pure and easy to
 * unit-test as MockAiProvider/DevRuleBasedProvider are.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "whatsapp-mock";
  private counter = 0;

  /** Every message this provider "sent", in call order — for tests, and for a future dev-only inbox panel to display what would have gone out (Phase 5D). */
  public sentMessages: Array<
    | { kind: "text"; input: WhatsAppTextMessage; result: WhatsAppSendResult }
    | { kind: "template"; input: WhatsAppTemplateMessage; result: WhatsAppSendResult }
    | { kind: "media"; input: WhatsAppMediaMessage; result: WhatsAppSendResult }
    | { kind: "document"; input: WhatsAppDocumentMessage; result: WhatsAppSendResult }
  > = [];

  async sendText(input: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    this.requireTo(input.to, "sendText");
    if (!input.body.trim()) throw new WhatsAppSendError('sendText: "body" must not be empty.');
    const result = this.nextResult("text", input);
    this.sentMessages.push({ kind: "text", input, result });
    return result;
  }

  async sendTemplate(input: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    this.requireTo(input.to, "sendTemplate");
    if (!input.templateName.trim()) throw new WhatsAppSendError('sendTemplate: "templateName" must not be empty.');
    if (!input.language.trim()) throw new WhatsAppSendError('sendTemplate: "language" must not be empty.');
    const result = this.nextResult("template", input);
    this.sentMessages.push({ kind: "template", input, result });
    return result;
  }

  async sendMedia(input: WhatsAppMediaMessage): Promise<WhatsAppSendResult> {
    this.requireTo(input.to, "sendMedia");
    if (!input.mediaUrl.trim()) throw new WhatsAppSendError('sendMedia: "mediaUrl" must not be empty.');
    if (!input.mimeType.trim()) throw new WhatsAppSendError('sendMedia: "mimeType" must not be empty.');
    const result = this.nextResult("media", input);
    this.sentMessages.push({ kind: "media", input, result });
    return result;
  }

  async sendDocument(input: WhatsAppDocumentMessage): Promise<WhatsAppSendResult> {
    this.requireTo(input.to, "sendDocument");
    if (!input.mediaUrl.trim()) throw new WhatsAppSendError('sendDocument: "mediaUrl" must not be empty.');
    if (!input.filename.trim()) throw new WhatsAppSendError('sendDocument: "filename" must not be empty.');
    const result = this.nextResult("document", input);
    this.sentMessages.push({ kind: "document", input, result });
    return result;
  }

  private requireTo(to: string, fnName: string): void {
    if (!to || !to.trim()) {
      throw new WhatsAppSendError(`${fnName}: "to" must not be empty.`);
    }
  }

  /** Synthesizes a delivery result and logs it — the one place that stands in for an actual Graph API call. */
  private nextResult(kind: "text" | "template" | "media" | "document", input: { to: string }): WhatsAppSendResult {
    this.counter += 1;
    console.log(`[whatsapp:mock] ${kind} -> ${input.to}`, input);
    return { externalId: `mock-wamid-${this.counter}`, status: "sent" };
  }
}

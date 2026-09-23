import "server-only";

/**
 * Phase 5B — mirrors src/lib/ai/errors.ts's shape exactly: every error this
 * channel adapter throws carries a `userMessage` safe to show directly (to
 * a staff member in the inbox, or to log without leaking internals) and a
 * `statusCode` a future route can pass straight through. Kept as its own
 * small hierarchy rather than reusing AiError, because a WhatsApp send
 * failure is a channel-adapter concern, not an AI-provider concern — the
 * Sales Agent never sees or throws these (Phase 5 plan's channel-agnostic
 * principle).
 */
export class WhatsAppChannelError extends Error {
  readonly userMessage: string;
  readonly statusCode: number;

  constructor(userMessage: string, opts: { statusCode?: number; cause?: unknown } = {}) {
    super(userMessage);
    this.name = "WhatsAppChannelError";
    this.userMessage = userMessage;
    this.statusCode = opts.statusCode ?? 500;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** Thrown by the provider factory when no usable WhatsApp provider is configured — mirrors AiConfigError. */
export class WhatsAppConfigError extends WhatsAppChannelError {
  constructor(
    message = "WhatsApp sending isn't configured yet. Set WHATSAPP_PROVIDER=mock for local development, or see the Phase 5 plan for production setup."
  ) {
    super(message, { statusCode: 503 });
    this.name = "WhatsAppConfigError";
  }
}

/** Thrown by a provider's send*() methods on invalid input or a failed send. */
export class WhatsAppSendError extends WhatsAppChannelError {
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message, { statusCode: 502, cause: opts.cause });
    this.name = "WhatsAppSendError";
  }
}

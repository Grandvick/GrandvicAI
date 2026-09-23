import "server-only";

/**
 * Every error the AI Core can throw carries a `userMessage` that is always
 * safe to show directly in the AI Command Center — never a stack trace, a
 * database error string, an API key fragment, or any other internal detail
 * (spec section 14/19). Server-side logs get the full `cause` via normal
 * `console.error`, callers should log `err` and show `err.userMessage`.
 */
export class AiError extends Error {
  readonly userMessage: string;
  readonly statusCode: number;

  constructor(userMessage: string, opts: { statusCode?: number; cause?: unknown } = {}) {
    super(userMessage);
    this.name = "AiError";
    this.userMessage = userMessage;
    this.statusCode = opts.statusCode ?? 500;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export class AiConfigError extends AiError {
  constructor(message = "The AI assistant isn't configured yet. Add OPENAI_API_KEY in Settings/.env.local — see SETUP.md.") {
    super(message, { statusCode: 503 });
    this.name = "AiConfigError";
  }
}

export class AiAuthError extends AiError {
  constructor(message = "You need to be signed in to use the AI assistant.") {
    super(message, { statusCode: 401 });
    this.name = "AiAuthError";
  }
}

export class AiBusinessContextError extends AiError {
  constructor(message: string) {
    super(message, { statusCode: 409 });
    this.name = "AiBusinessContextError";
  }
}

export class AiRateLimitError extends AiError {
  constructor(retryAfterSeconds: number) {
    super(`You're sending requests too quickly. Try again in ${retryAfterSeconds}s.`, { statusCode: 429 });
    this.name = "AiRateLimitError";
  }
}

export class AiValidationError extends AiError {
  constructor(message = "That request wasn't understood — try rephrasing it.") {
    super(message, { statusCode: 400 });
    this.name = "AiValidationError";
  }
}

export class AiToolError extends AiError {
  constructor(toolName: string, message: string, opts: { cause?: unknown } = {}) {
    super(message, { statusCode: 500, cause: opts.cause });
    this.name = "AiToolError";
    this.toolName = toolName;
  }
  toolName: string;
}

export class AiProviderError extends AiError {
  constructor(
    message = "The AI provider is temporarily unavailable. Please try again in a moment.",
    opts: { statusCode?: number; cause?: unknown } = {}
  ) {
    super(message, opts);
    this.name = "AiProviderError";
  }
}

/** Normalizes any thrown value into an AiError, never leaking internals to the caller. */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  console.error("[ai] unexpected error", err);
  return new AiError("Something went wrong on our side. Please try again.");
}

/** Normalized error types for the Amazon Ads API integration layer. */

export class AdsApiError extends Error {
  override name = "AdsApiError";
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** Human-readable, safe-to-surface summary for tool output. */
  toUserMessage(): string {
    const parts = [`Amazon Ads API error (HTTP ${this.status}): ${this.message}`];
    if (this.requestId) parts.push(`request-id: ${this.requestId}`);
    if (this.details !== undefined) {
      parts.push(`details: ${JSON.stringify(this.details)}`);
    }
    return parts.join(" | ");
  }
}

export class AuthError extends AdsApiError {
  override name = "AuthError";
}

export class RateLimitError extends AdsApiError {
  override name = "RateLimitError";
  constructor(
    message: string,
    requestId?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message, 429, requestId);
  }
}

export class ValidationError extends Error {
  override name = "ValidationError";
}

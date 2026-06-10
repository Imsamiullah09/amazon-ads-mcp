import type { Logger } from "../logging.js";
import { AuthError } from "../http/errors.js";

export interface TokenManagerOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  logger: Logger;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Refresh this many ms before actual expiry. Default 5 minutes. */
  expiryBufferMs?: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Manages the Login-with-Amazon access token lifecycle.
 *
 * - Access tokens are valid for ~60 minutes; we refresh 5 minutes early.
 * - Concurrent callers share a single in-flight refresh (single-flight),
 *   so parallel tool calls never stampede the token endpoint.
 * - The refresh token itself is long-lived and never logged.
 */
export class TokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;

  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly expiryBufferMs: number;

  constructor(private readonly opts: TokenManagerOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
    this.expiryBufferMs = opts.expiryBufferMs ?? 5 * 60 * 1000;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt - this.expiryBufferMs) {
      return this.accessToken;
    }
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Force-invalidate the cached token (e.g. after a 401). */
  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.opts.refreshToken,
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
    });

    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchFn(this.opts.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new AuthError(
        `Token refresh request failed: ${(err as Error).message}`,
        0,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AuthError(
        `Token refresh rejected by LwA (check client id/secret/refresh token and region): ${text.slice(0, 500)}`,
        res.status,
      );
    }

    const data = (await res.json()) as TokenResponse;
    if (!data.access_token || !data.expires_in) {
      throw new AuthError("Token endpoint returned an unexpected payload", res.status);
    }

    this.accessToken = data.access_token;
    this.expiresAt = this.now() + data.expires_in * 1000;
    this.opts.logger.debug(
      { durationMs: this.now() - started, expiresInS: data.expires_in },
      "LwA access token refreshed",
    );
    return this.accessToken;
  }
}

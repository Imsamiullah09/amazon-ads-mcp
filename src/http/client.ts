import { createHash } from "node:crypto";
import type { Logger } from "../logging.js";
import type { TokenManager } from "../auth/token-manager.js";
import type { TokenBucket } from "./rate-limiter.js";
import type { TtlCache } from "../cache/memory-cache.js";
import { AdsApiError, AuthError, RateLimitError } from "./errors.js";

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Amazon-Advertising-API-Scope header (advertiser profile id). */
  profileId?: string;
  /** Extra headers, e.g. versioned media types or AMC entity headers. */
  headers?: Record<string, string>;
  /** Content-Type for the request body. Default application/json. */
  contentType?: string;
  /** Accept header. Default application/json. */
  accept?: string;
  /** Cache TTL override in ms. 0 disables caching for this call. */
  cacheTtlMs?: number;
}

export interface AdsHttpClientOptions {
  apiBase: string;
  clientId: string;
  tokenManager: TokenManager;
  rateLimiter: TokenBucket;
  cache: TtlCache;
  logger: Logger;
  maxRetries: number;
  defaultCacheTtlMs: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Statuses worth retrying: throttling and transient server-side failures. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * HTTP client for the Amazon Ads API.
 *
 * Responsibilities:
 *  - attach auth + required identity headers on every call
 *  - client-side rate limiting (token bucket)
 *  - retries with exponential backoff + jitter, honoring Retry-After on 429
 *  - one automatic token refresh + retry on 401
 *  - response caching for idempotent reads
 *  - normalized errors carrying Amazon's request id for support escalation
 */
export class AdsHttpClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: AdsHttpClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T = unknown>(req: RequestOptions): Promise<T> {
    const url = this.buildUrl(req);
    const cacheKey = this.cacheKey(req, url);
    const ttl = req.cacheTtlMs ?? this.opts.defaultCacheTtlMs;

    if (ttl > 0) {
      const hit = this.opts.cache.get(cacheKey);
      if (hit !== undefined) {
        this.opts.logger.debug({ path: req.path }, "cache hit");
        return hit as T;
      }
    }

    const result = await this.execute<T>(req, url);
    if (ttl > 0) this.opts.cache.set(cacheKey, result, ttl);
    return result;
  }

  private buildUrl(req: RequestOptions): string {
    const url = new URL(req.path, this.opts.apiBase);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private cacheKey(req: RequestOptions, url: string): string {
    const h = createHash("sha256");
    h.update(req.method);
    h.update(url);
    h.update(req.profileId ?? "");
    h.update(req.accept ?? "");
    if (req.body !== undefined) h.update(JSON.stringify(req.body));
    return h.digest("hex");
  }

  private async execute<T>(req: RequestOptions, url: string): Promise<T> {
    const maxAttempts = this.opts.maxRetries + 1;
    let refreshedAfter401 = false;
    let lastError: Error = new AdsApiError("request not attempted", 0);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.opts.rateLimiter.acquire();
      const token = await this.opts.tokenManager.getAccessToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Amazon-Advertising-API-ClientId": this.opts.clientId,
        Accept: req.accept ?? "application/json",
        ...req.headers,
      };
      if (req.profileId) {
        headers["Amazon-Advertising-API-Scope"] = req.profileId;
      }
      if (req.body !== undefined) {
        headers["Content-Type"] = req.contentType ?? "application/json";
      }

      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: req.method,
          headers,
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        });
      } catch (err) {
        lastError = new AdsApiError(
          `Network error calling ${req.method} ${req.path}: ${(err as Error).message}`,
          0,
        );
        this.opts.logger.warn(
          { path: req.path, attempt, err: (err as Error).message },
          "network error, will retry",
        );
        await this.backoff(attempt);
        continue;
      }

      const requestId =
        res.headers.get("x-amz-request-id") ??
        res.headers.get("x-amz-rid") ??
        undefined;
      const durationMs = Date.now() - started;
      this.opts.logger.debug(
        { method: req.method, path: req.path, status: res.status, durationMs, requestId },
        "ads api response",
      );

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      }

      // 401: token may have been revoked mid-lifetime — refresh once.
      if (res.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        this.opts.tokenManager.invalidate();
        this.opts.logger.warn({ path: req.path, requestId }, "401 received, refreshing token");
        continue;
      }

      const bodyText = await res.text().catch(() => "");
      const details = safeJson(bodyText);

      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        lastError = new RateLimitError(
          "Throttled by Amazon Ads API",
          requestId,
          retryAfter,
        );
        if (attempt < maxAttempts - 1) {
          const waitMs = retryAfter !== undefined ? retryAfter * 1000 : this.backoffDelay(attempt);
          this.opts.logger.warn({ path: req.path, waitMs, requestId }, "429 throttled, backing off");
          await this.sleep(waitMs);
          continue;
        }
      } else if (RETRYABLE_STATUSES.has(res.status)) {
        lastError = new AdsApiError(
          `Transient upstream failure: ${summarize(bodyText)}`,
          res.status,
          requestId,
          details,
        );
        if (attempt < maxAttempts - 1) {
          await this.backoff(attempt);
          continue;
        }
      } else if (res.status === 401 || res.status === 403) {
        throw new AuthError(
          `Access denied (${res.status}). Check credentials, profile scope, and that your account has access to this API surface: ${summarize(bodyText)}`,
          res.status,
          requestId,
          details,
        );
      } else {
        // Non-retryable client error — surface immediately with details.
        throw new AdsApiError(summarize(bodyText) || `HTTP ${res.status}`, res.status, requestId, details);
      }
    }
    throw lastError;
  }

  private backoffDelay(attempt: number): number {
    const base = 500 * 2 ** attempt;
    const jitter = Math.random() * base * 0.5;
    return Math.min(30_000, base + jitter);
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(this.backoffDelay(attempt));
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text || undefined;
  }
}

function summarize(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 500);
}

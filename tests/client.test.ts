import { describe, expect, it, vi } from "vitest";
import { AdsHttpClient } from "../src/http/client.js";
import { TokenBucket } from "../src/http/rate-limiter.js";
import { TtlCache } from "../src/cache/memory-cache.js";
import { AdsApiError, AuthError } from "../src/http/errors.js";
import type { TokenManager } from "../src/auth/token-manager.js";
import { jsonResponse, silentLogger } from "./helpers.js";

function fakeTokenManager(): TokenManager {
  return {
    getAccessToken: vi.fn(async () => "tok"),
    invalidate: vi.fn(),
  } as unknown as TokenManager;
}

function makeClient(
  fetchFn: ReturnType<typeof vi.fn>,
  opts: { maxRetries?: number; cacheTtlMs?: number; tokenManager?: TokenManager } = {},
) {
  const tokenManager = opts.tokenManager ?? fakeTokenManager();
  const client = new AdsHttpClient({
    apiBase: "https://advertising-api.amazon.com",
    clientId: "cid",
    tokenManager,
    rateLimiter: new TokenBucket(1000, 1000),
    cache: new TtlCache(50),
    logger: silentLogger,
    maxRetries: opts.maxRetries ?? 2,
    defaultCacheTtlMs: opts.cacheTtlMs ?? 0,
    fetchFn: fetchFn as unknown as typeof fetch,
    sleep: async () => {},
  });
  return { client, tokenManager };
}

describe("AdsHttpClient", () => {
  it("sends auth, client-id and scope headers", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    const { client } = makeClient(fetchFn);

    await client.request({ method: "GET", path: "/v2/profiles", profileId: "p1" });

    const headers = fetchFn.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Amazon-Advertising-API-ClientId"]).toBe("cid");
    expect(headers["Amazon-Advertising-API-Scope"]).toBe("p1");
  });

  it("uses versioned media types when given", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ campaigns: [] }));
    const { client } = makeClient(fetchFn);
    const media = "application/vnd.spCampaign.v3+json";

    await client.request({
      method: "POST",
      path: "/sp/campaigns/list",
      body: {},
      contentType: media,
      accept: media,
    });

    const headers = fetchFn.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe(media);
    expect(headers.Accept).toBe(media);
  });

  it("retries on 429 honoring Retry-After, then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "Retry-After": "1" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { client } = makeClient(fetchFn);

    const result = await client.request<{ ok: boolean }>({ method: "GET", path: "/x" });
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 and gives up after maxRetries with normalized error", async () => {
    const fetchFn = vi.fn(async () =>
      new Response("upstream broke", {
        status: 500,
        headers: { "x-amz-request-id": "req-123" },
      }),
    );
    const { client } = makeClient(fetchFn, { maxRetries: 2 });

    const err = await client.request({ method: "GET", path: "/x" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdsApiError);
    expect((err as AdsApiError).status).toBe(500);
    expect((err as AdsApiError).requestId).toBe("req-123");
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry 4xx client errors", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ message: "bad filter" }), { status: 400 }),
    );
    const { client } = makeClient(fetchFn);

    await expect(client.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(
      AdsApiError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("invalidates token and retries once on 401, then fails with AuthError", async () => {
    const fetchFn = vi.fn(async () => new Response("expired", { status: 401 }));
    const { client, tokenManager } = makeClient(fetchFn);

    await expect(client.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(
      AuthError,
    );
    expect(tokenManager.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("caches GET responses for the configured TTL", async () => {
    const fetchFn = vi.fn(async () => jsonResponse([{ profileId: 1 }]));
    const { client } = makeClient(fetchFn, { cacheTtlMs: 60_000 });

    await client.request({ method: "GET", path: "/v2/profiles" });
    await client.request({ method: "GET", path: "/v2/profiles" });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Different profile scope must not share cache entries.
    await client.request({ method: "GET", path: "/v2/profiles", profileId: "p2" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("never caches when cacheTtlMs is 0", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ status: "PENDING" }));
    const { client } = makeClient(fetchFn, { cacheTtlMs: 60_000 });

    await client.request({ method: "GET", path: "/reporting/reports/r1", cacheTtlMs: 0 });
    await client.request({ method: "GET", path: "/reporting/reports/r1", cacheTtlMs: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries network errors", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { client } = makeClient(fetchFn);

    const result = await client.request<{ ok: boolean }>({ method: "GET", path: "/x" });
    expect(result.ok).toBe(true);
  });
});

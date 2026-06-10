import { describe, expect, it, vi } from "vitest";
import { TokenManager } from "../src/auth/token-manager.js";
import { AuthError } from "../src/http/errors.js";
import { silentLogger, tokenResponse } from "./helpers.js";

function makeManager(fetchFn: typeof fetch, now?: () => number) {
  return new TokenManager({
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    clientId: "cid",
    clientSecret: "sec",
    refreshToken: "rt",
    logger: silentLogger,
    fetchFn,
    now,
  });
}

describe("TokenManager", () => {
  it("refreshes and caches the access token", async () => {
    const fetchFn = vi.fn(async () => tokenResponse());
    const tm = makeManager(fetchFn as unknown as typeof fetch);

    expect(await tm.getAccessToken()).toBe("test-access-token");
    expect(await tm.getAccessToken()).toBe("test-access-token");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const body = fetchFn.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt");
  });

  it("single-flights concurrent refreshes", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchFn = vi.fn(
      () => new Promise<Response>((r) => (resolveFetch = r)),
    );
    const tm = makeManager(fetchFn as unknown as typeof fetch);

    const p1 = tm.getAccessToken();
    const p2 = tm.getAccessToken();
    resolveFetch(tokenResponse());
    expect(await p1).toBe("test-access-token");
    expect(await p2).toBe("test-access-token");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refreshes again when within the expiry buffer", async () => {
    let t = 0;
    const fetchFn = vi.fn(async () => tokenResponse(3600));
    const tm = makeManager(fetchFn as unknown as typeof fetch, () => t);

    await tm.getAccessToken();
    t = 3600 * 1000 - 4 * 60 * 1000; // 4 min before expiry — inside 5-min buffer
    await tm.getAccessToken();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws AuthError with status on rejection", async () => {
    const fetchFn = vi.fn(
      async () => new Response("invalid_grant", { status: 400 }),
    );
    const tm = makeManager(fetchFn as unknown as typeof fetch);
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });

  it("invalidate() forces a refresh on next call", async () => {
    const fetchFn = vi.fn(async () => tokenResponse());
    const tm = makeManager(fetchFn as unknown as typeof fetch);
    await tm.getAccessToken();
    tm.invalidate();
    await tm.getAccessToken();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

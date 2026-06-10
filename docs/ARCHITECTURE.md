# Architecture

## Module layout

```
src/
├── index.ts              # entry: config load, transport selection
├── server.ts             # dependency wiring + McpServer construction
├── config.ts             # zod-validated env config, region endpoint map
├── logging.ts            # pino → stderr, secret redaction
├── auth/
│   └── token-manager.ts  # LwA refresh, expiry buffer, single-flight
├── http/
│   ├── client.ts         # auth headers, retries, backoff, caching
│   ├── rate-limiter.ts   # token bucket (FIFO-fair)
│   └── errors.ts         # AdsApiError / AuthError / RateLimitError / ValidationError
├── cache/
│   └── memory-cache.ts   # bounded TTL cache
├── api/                  # one module per Amazon API surface (pure functions)
│   ├── profiles.ts       # /v2/profiles
│   ├── sponsored-products.ts  # SP v3, versioned media types
│   ├── sponsored-brands.ts    # SB v4
│   ├── sponsored-display.ts   # SD (index pagination)
│   ├── reporting.ts      # Reporting v3 create/status/download + gunzip
│   ├── dsp.ts            # DSP reports + orders
│   └── amc.ts            # AMC workflows/executions (entity headers)
├── validation/
│   └── reconcile.ts      # report integrity checks + server-side totals
├── tools/
│   └── register.ts       # MCP tool schemas + handlers (thin over api/)
└── transport/
    └── http.ts           # streamable HTTP (stateless) for Docker/remote
```

## Layering rules

1. **`api/` modules are pure** — they know endpoint paths, media types and payload shapes, and take an `AdsHttpClient`. No MCP, no env, no logging decisions. This is the layer to extend when Amazon ships a new API version.
2. **`http/client.ts` owns every cross-cutting concern**: auth header injection, the client-side rate limit, retries/backoff, 401-refresh, caching, error normalization, timing logs. API modules never retry on their own — that would multiply retries.
3. **`tools/register.ts` is presentation**: zod input schemas (which become the JSON Schema Claude sees), profileId defaulting, output shaping, and the `guard()` wrapper that converts every exception into an `isError` tool result so a failed Amazon call never crashes the protocol stream.

## Key design decisions

**Read-only v1.** Campaign mutations against live ad spend from a conversational agent need explicit-confirmation UX and idempotency guarantees that deserve their own design pass. Excluding them makes the server safe to hand to any client unattended.

**Single-flight token refresh.** Claude frequently issues parallel tool calls. Without de-duplication, five concurrent calls with an expired token would fire five refreshes; LwA rate-limits the token endpoint quickly.

**Token bucket + retry, not either alone.** Amazon's throttling is dynamic and per-account, so a static client-side rate can't be "correct" — it only smooths bursts. 429s still happen under account-wide pressure (other tools share your quota), so the retry layer honors `Retry-After` and backs off exponentially with jitter.

**Reconciliation lives server-side.** LLMs are unreliable at summing hundreds of rows, and inline output must be bounded anyway. Computing totals/integrity checks in code and instructing the model (via server `instructions` and tool descriptions) to quote them keeps reported numbers exactly equal to Amazon's data.

**Bounded inline rows + optional file dump.** Reports can be tens of MB. `download_report` returns totals plus ≤500 sample rows; `saveAs` (basename-only, fixed output dir — no path traversal) persists the full set for spreadsheets or further processing.

**Report downloads skip auth headers.** Completed reports live behind S3-signed URLs; sending the Ads `Authorization` header to S3 breaks the signature. The download path uses a bare fetch on purpose.

**Stateless HTTP transport.** Each POST /mcp builds a fresh server+transport pair: horizontally scalable, no session store. The cost (re-listing tools per session) is trivial. The endpoint ships without its own auth because it wraps a single advertiser's credentials — multi-tenant auth belongs in a fronting proxy, not here.

**Caching is conservative.** 60 s TTL on entity reads only (keyed by method+URL+body+profile+accept hash). Report status and downloads are never cached — stale `PENDING` status or an expired signed URL would directly violate the accuracy requirement.

## Error taxonomy

| Class | Meaning | Retried? |
|---|---|---|
| `RateLimitError` (429) | Amazon throttling | ✅ honoring `Retry-After` |
| `AdsApiError` 5xx | transient upstream | ✅ backoff + jitter |
| network error | DNS/reset/timeout | ✅ backoff |
| 401 (once) | token revoked mid-lifetime | ✅ single re-auth |
| `AuthError` 401/403 | bad credentials or missing entitlement (DSP/AMC) | ❌ surfaced with guidance |
| `AdsApiError` 4xx | bad request | ❌ surfaced with Amazon's message + request id |
| `ValidationError` | rejected before calling Amazon (bad dates, unsafe paths) | ❌ |

## Testing strategy

- Unit tests per infrastructure component (token manager, rate limiter, cache, HTTP client) with injected clocks/sleeps — no timers, no flakiness.
- Report pipeline tests use real gzip buffers.
- Wire-protocol tests connect a real MCP `Client` over `InMemoryTransport` to the fully built server with `fetch` mocked at the boundary — asserting tool listing, live-data passthrough, and error surfacing exactly as Claude would see them.
- CI additionally smoke-tests that the built artifact fails fast with a readable message when unconfigured.

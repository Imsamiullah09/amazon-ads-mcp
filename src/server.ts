import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logging.js";
import { TokenManager } from "./auth/token-manager.js";
import { TokenBucket } from "./http/rate-limiter.js";
import { TtlCache } from "./cache/memory-cache.js";
import { AdsHttpClient } from "./http/client.js";
import { registerTools, type ToolDeps } from "./tools/register.js";

export const SERVER_NAME = "amazon-ads-mcp";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Amazon Ads MCP server. Read-only access to Amazon Advertising data.

Typical workflow:
1. get_profiles → pick the advertiser profileId (or rely on the configured default).
2. Entity tools (sp_/sb_/sd_list_*) return campaign STRUCTURE (budgets, states, bids) — never performance metrics.
3. Performance metrics come from async reports: create_report → get_report_status (poll; reports take minutes) → download_report.
4. download_report returns server-computed reconciled totals — quote those totals; do not re-sum the inline row sample, which may be truncated.
5. DSP and AMC tools require extra Amazon entitlements (DSP seat, provisioned AMC instance); 403 there means missing entitlement, not an error in the request.

All data comes live from the Amazon Ads API (60s response cache for entity reads). Currency values are in the profile's currency; dates are in the profile's timezone.`;

export interface BuildServerOptions {
  config: AppConfig;
  logger: Logger;
  /** Test seam: inject a fetch implementation. */
  fetchFn?: typeof fetch;
}

export interface BuiltServer {
  server: McpServer;
  deps: ToolDeps;
}

export function buildServer(opts: BuildServerOptions): BuiltServer {
  const { config, logger, fetchFn } = opts;

  const tokenManager = new TokenManager({
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
    logger,
    fetchFn,
  });

  const client = new AdsHttpClient({
    apiBase: config.apiBase,
    clientId: config.clientId,
    tokenManager,
    rateLimiter: new TokenBucket(Math.max(1, config.rateLimitRps), config.rateLimitRps),
    cache: new TtlCache(500),
    logger,
    maxRetries: config.maxRetries,
    defaultCacheTtlMs: config.cacheTtlMs,
    fetchFn,
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const deps: ToolDeps = { config, client, logger };
  registerTools(server, deps);
  return { server, deps };
}

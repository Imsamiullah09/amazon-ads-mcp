import pino from "pino";
import type { AppConfig } from "../src/config.js";

export const silentLogger = pino({ level: "silent" });

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    clientId: "amzn1.application-oa2-client.test",
    clientSecret: "secret",
    refreshToken: "Atzr|refresh",
    region: "NA",
    apiBase: "https://advertising-api.amazon.com",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    defaultProfileId: "111111",
    transport: "stdio",
    httpPort: 3000,
    rateLimitRps: 1000,
    cacheTtlMs: 0,
    maxRetries: 2,
    logLevel: "silent",
    reportOutputDir: "./reports-output",
    ...overrides,
  };
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

export function tokenResponse(expiresIn = 3600): Response {
  return jsonResponse({
    access_token: "test-access-token",
    token_type: "bearer",
    expires_in: expiresIn,
  });
}

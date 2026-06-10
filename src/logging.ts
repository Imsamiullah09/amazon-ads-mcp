import pino from "pino";
import type { Logger } from "pino";

/**
 * All logs go to stderr. In stdio transport mode, stdout carries the MCP
 * JSON-RPC stream and must never receive log output.
 */
export function createLogger(level: string): Logger {
  return pino(
    {
      level,
      base: { service: "amazon-ads-mcp" },
      redact: {
        paths: [
          "*.authorization",
          "*.Authorization",
          "*.refresh_token",
          "*.access_token",
          "*.client_secret",
        ],
        censor: "[REDACTED]",
      },
    },
    pino.destination(2),
  );
}

export type { Logger };

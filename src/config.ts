import { z } from "zod";

/**
 * Region endpoint map.
 * Verified against Amazon Ads API docs: API hosts are regional, and the
 * Login-with-Amazon token endpoint differs per region.
 * https://advertising.amazon.com/API/docs/en-us/info/api-overview
 */
export const REGIONS = {
  NA: {
    apiBase: "https://advertising-api.amazon.com",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
  },
  EU: {
    apiBase: "https://advertising-api-eu.amazon.com",
    tokenUrl: "https://api.amazon.co.uk/auth/o2/token",
  },
  FE: {
    apiBase: "https://advertising-api-fe.amazon.com",
    tokenUrl: "https://api.amazon.co.jp/auth/o2/token",
  },
} as const;

export type Region = keyof typeof REGIONS;

const envSchema = z.object({
  AMAZON_ADS_CLIENT_ID: z.string().min(1, "AMAZON_ADS_CLIENT_ID is required"),
  AMAZON_ADS_CLIENT_SECRET: z
    .string()
    .min(1, "AMAZON_ADS_CLIENT_SECRET is required"),
  AMAZON_ADS_REFRESH_TOKEN: z
    .string()
    .min(1, "AMAZON_ADS_REFRESH_TOKEN is required"),
  AMAZON_ADS_REGION: z.enum(["NA", "EU", "FE"]).default("NA"),
  AMAZON_ADS_PROFILE_ID: z.string().optional(),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3000),
  AMAZON_ADS_RATE_LIMIT_RPS: z.coerce.number().positive().default(5),
  AMAZON_ADS_CACHE_TTL_SECONDS: z.coerce.number().nonnegative().default(60),
  AMAZON_ADS_MAX_RETRIES: z.coerce.number().int().nonnegative().default(4),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  REPORT_OUTPUT_DIR: z.string().default("./reports-output"),
});

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  region: Region;
  apiBase: string;
  tokenUrl: string;
  defaultProfileId?: string;
  transport: "stdio" | "http";
  httpPort: number;
  rateLimitRps: number;
  cacheTtlMs: number;
  maxRetries: number;
  logLevel: string;
  reportOutputDir: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Parse and validate configuration from environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const region = REGIONS[e.AMAZON_ADS_REGION];
  return {
    clientId: e.AMAZON_ADS_CLIENT_ID,
    clientSecret: e.AMAZON_ADS_CLIENT_SECRET,
    refreshToken: e.AMAZON_ADS_REFRESH_TOKEN,
    region: e.AMAZON_ADS_REGION,
    apiBase: region.apiBase,
    tokenUrl: region.tokenUrl,
    defaultProfileId: e.AMAZON_ADS_PROFILE_ID || undefined,
    transport: e.MCP_TRANSPORT,
    httpPort: e.MCP_HTTP_PORT,
    rateLimitRps: e.AMAZON_ADS_RATE_LIMIT_RPS,
    cacheTtlMs: e.AMAZON_ADS_CACHE_TTL_SECONDS * 1000,
    maxRetries: e.AMAZON_ADS_MAX_RETRIES,
    logLevel: e.LOG_LEVEL,
    reportOutputDir: e.REPORT_OUTPUT_DIR,
  };
}

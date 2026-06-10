#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, ConfigError } from "./config.js";
import { createLogger } from "./logging.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./transport/http.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Config errors must be human-readable: this is the first thing a new
      // user hits. stderr is safe in both transports.
      console.error(`\n[amazon-ads-mcp] ${err.message}`);
      console.error(
        "[amazon-ads-mcp] Copy .env.example to .env (or set env vars in your MCP client config) and fill in your LwA credentials.\n",
      );
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(config.logLevel);

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: String(reason) }, "unhandled rejection");
  });

  if (config.transport === "http") {
    await startHttpServer(config, logger);
    return;
  }

  const { server } = buildServer({ config, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ region: config.region }, "amazon-ads-mcp connected over stdio");
}

main().catch((err) => {
  console.error("[amazon-ads-mcp] fatal:", err);
  process.exit(1);
});

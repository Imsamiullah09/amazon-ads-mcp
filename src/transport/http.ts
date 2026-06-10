import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logging.js";
import { buildServer } from "../server.js";

/**
 * Streamable-HTTP transport for Docker / remote deployment.
 *
 * Stateless mode: each request gets a fresh transport + server instance, so
 * the endpoint scales horizontally with no session affinity. The Amazon Ads
 * credentials are still the server's own (single-tenant): put this behind
 * your own network controls — it intentionally ships with no public auth
 * layer, because exposing one advertiser's credentials publicly is never
 * the right design. For multi-user deployments add an authenticating proxy.
 */
export async function startHttpServer(config: AppConfig, logger: Logger): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "amazon-ads-mcp" });
  });

  app.post("/mcp", async (req, res) => {
    try {
      const { server } = buildServer({ config, logger });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err: (err as Error).message }, "mcp http request failed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless server: no SSE notification stream or session termination.
  app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").send());
  app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").send());

  await new Promise<void>((resolveListen) => {
    app.listen(config.httpPort, () => resolveListen());
  });
  logger.info({ port: config.httpPort }, "amazon-ads-mcp listening (streamable HTTP) at /mcp");
}

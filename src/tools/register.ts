import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import type { AdsHttpClient } from "../http/client.js";
import type { Logger } from "../logging.js";
import { AdsApiError, ValidationError } from "../http/errors.js";
import * as profiles from "../api/profiles.js";
import * as sp from "../api/sponsored-products.js";
import * as sb from "../api/sponsored-brands.js";
import * as sd from "../api/sponsored-display.js";
import * as reporting from "../api/reporting.js";
import * as dsp from "../api/dsp.js";
import * as amc from "../api/amc.js";
import { reconcileReport } from "../validation/reconcile.js";

export interface ToolDeps {
  config: AppConfig;
  client: AdsHttpClient;
  logger: Logger;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const message =
    err instanceof AdsApiError
      ? err.toUserMessage()
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wrap a handler so every tool reports errors uniformly instead of throwing. */
function guard<A>(
  logger: Logger,
  name: string,
  fn: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      logger.error({ tool: name, err: (err as Error).message }, "tool failed");
      return fail(err);
    }
  };
}

// ── shared schema fragments ──────────────────────────────────────────────────

const profileIdSchema = z
  .string()
  .optional()
  .describe(
    "Amazon Ads profile id (Amazon-Advertising-API-Scope). Omit to use the AMAZON_ADS_PROFILE_ID default. Discover ids with get_profiles.",
  );

const spSbStateSchema = z
  .array(z.enum(["ENABLED", "PAUSED", "ARCHIVED"]))
  .optional()
  .describe("Filter by entity state. Omit for all states.");

const paginationSchema = {
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Page size (Amazon max varies by endpoint; <=1000)."),
  nextToken: z
    .string()
    .optional()
    .describe("Opaque pagination token from a previous response."),
};

const amcContextSchema = {
  entityId: z
    .string()
    .describe("AMC entity id (Amazon-Advertising-API-AdvertiserId header), e.g. ENTITY1ABC…"),
  marketplaceId: z
    .string()
    .describe("Marketplace id (Amazon-Advertising-API-MarketplaceId header), e.g. ATVPDKIKX0DER for amazon.com"),
};

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { config, client, logger } = deps;

  const resolveProfile = (profileId?: string): string => {
    const id = profileId ?? config.defaultProfileId;
    if (!id) {
      throw new ValidationError(
        "No profileId given and AMAZON_ADS_PROFILE_ID is not set. Call get_profiles first and pass a profileId.",
      );
    }
    return id;
  };

  // ── Profiles / diagnostics ────────────────────────────────────────────────

  server.registerTool(
    "get_profiles",
    {
      title: "List advertiser profiles",
      description:
        "List all Amazon Ads advertiser profiles (accounts) accessible to these credentials in the configured region. Returns profileId, marketplace, currency, timezone and account info. Call this first: the profileId scopes every other tool.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "get_profiles", async () => ok(await profiles.listProfiles(client))),
  );

  server.registerTool(
    "health_check",
    {
      title: "Connection health check",
      description:
        "Verify credentials and connectivity: refreshes the LwA access token and lists profiles, reporting region, latency and configuration (secrets redacted). Use to diagnose auth/setup issues.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "health_check", async () => {
      const started = Date.now();
      const profileList = await profiles.listProfiles(client);
      return ok({
        status: "ok",
        region: config.region,
        apiBase: config.apiBase,
        latencyMs: Date.now() - started,
        profilesAccessible: profileList.length,
        defaultProfileId: config.defaultProfileId ?? null,
        rateLimitRps: config.rateLimitRps,
        cacheTtlSeconds: config.cacheTtlMs / 1000,
      });
    }),
  );

  // ── Sponsored Products ────────────────────────────────────────────────────

  const spListInput = {
    profileId: profileIdSchema,
    stateFilter: spSbStateSchema,
    campaignIds: z.array(z.string()).optional().describe("Restrict to these campaign ids."),
    ...paginationSchema,
  };

  server.registerTool(
    "sp_list_campaigns",
    {
      title: "List Sponsored Products campaigns",
      description:
        "List Sponsored Products campaigns (v3) with budgets, states, targeting type and dates. Paginate with nextToken. For performance metrics, use create_report instead — entity endpoints return configuration, not spend/sales.",
      inputSchema: spListInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sp_list_campaigns", async (a) =>
      ok(await sp.listCampaigns(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "sp_list_ad_groups",
    {
      title: "List Sponsored Products ad groups",
      description:
        "List Sponsored Products ad groups (v3), optionally filtered to specific campaigns. Paginate with nextToken.",
      inputSchema: spListInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sp_list_ad_groups", async (a) =>
      ok(await sp.listAdGroups(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "sp_list_keywords",
    {
      title: "List Sponsored Products keywords",
      description:
        "List Sponsored Products keywords (v3) with match types, bids and states. Filter by campaignIds or adGroupIds; paginate with nextToken.",
      inputSchema: {
        ...spListInput,
        adGroupIds: z.array(z.string()).optional().describe("Restrict to these ad group ids."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sp_list_keywords", async (a) =>
      ok(await sp.listKeywords(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "sp_list_targets",
    {
      title: "List Sponsored Products product/category targets",
      description:
        "List Sponsored Products targeting clauses (v3): product, category and auto-targeting expressions with bids and states.",
      inputSchema: {
        ...spListInput,
        adGroupIds: z.array(z.string()).optional().describe("Restrict to these ad group ids."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sp_list_targets", async (a) =>
      ok(await sp.listTargets(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "sp_list_product_ads",
    {
      title: "List Sponsored Products product ads",
      description:
        "List Sponsored Products product ads (v3): which ASINs/SKUs are advertised in which ad groups, with states.",
      inputSchema: {
        ...spListInput,
        adGroupIds: z.array(z.string()).optional().describe("Restrict to these ad group ids."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sp_list_product_ads", async (a) =>
      ok(await sp.listProductAds(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  // ── Sponsored Brands ──────────────────────────────────────────────────────

  const sbListInput = {
    profileId: profileIdSchema,
    stateFilter: spSbStateSchema,
    campaignIds: z.array(z.string()).optional(),
    ...paginationSchema,
  };

  server.registerTool(
    "sb_list_campaigns",
    {
      title: "List Sponsored Brands campaigns",
      description:
        "List Sponsored Brands campaigns (v4) with budgets, states and dates. Paginate with nextToken. Use create_report (adProduct SPONSORED_BRANDS) for performance metrics.",
      inputSchema: sbListInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sb_list_campaigns", async (a) =>
      ok(await sb.listCampaigns(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "sb_list_ad_groups",
    {
      title: "List Sponsored Brands ad groups",
      description: "List Sponsored Brands ad groups (v4), optionally filtered by campaign ids.",
      inputSchema: sbListInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sb_list_ad_groups", async (a) =>
      ok(await sb.listAdGroups(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  // ── Sponsored Display ─────────────────────────────────────────────────────

  const sdListInput = {
    profileId: profileIdSchema,
    stateFilter: z
      .array(z.enum(["enabled", "paused", "archived"]))
      .optional()
      .describe("SD uses lower-case states."),
    startIndex: z.number().int().min(0).optional().describe("0-based pagination offset."),
    count: z.number().int().min(1).max(100).optional().describe("Page size, max 100."),
  };

  server.registerTool(
    "sd_list_campaigns",
    {
      title: "List Sponsored Display campaigns",
      description:
        "List Sponsored Display campaigns with budgets, tactics and states. Uses startIndex/count pagination (not nextToken).",
      inputSchema: sdListInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sd_list_campaigns", async (a) =>
      ok(await sd.listCampaigns(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "sd_list_ad_groups",
    {
      title: "List Sponsored Display ad groups",
      description: "List Sponsored Display ad groups with bid optimization settings and states.",
      inputSchema: sdListInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "sd_list_ad_groups", async (a) =>
      ok(await sd.listAdGroups(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  // ── Reporting v3 (SP / SB / SD performance metrics) ───────────────────────

  server.registerTool(
    "create_report",
    {
      title: "Create performance report (async)",
      description:
        "Request an async performance report (Reporting v3) for Sponsored Products, Brands or Display. Returns a reportId immediately; reports typically complete in 1–15 minutes (up to ~3h for large accounts). Poll with get_report_status, then fetch data with download_report. Common reportTypeIds: spCampaigns, spTargeting, spSearchTerm, spAdvertisedProduct, sbCampaigns, sdCampaigns. Example columns for spCampaigns: campaignId, campaignName, impressions, clicks, cost, purchases14d, sales14d (+ date when timeUnit=DAILY).",
      inputSchema: {
        profileId: profileIdSchema,
        startDate: z.string().describe("YYYY-MM-DD, in the profile's timezone. Most report types allow up to ~95 days lookback."),
        endDate: z.string().describe("YYYY-MM-DD inclusive."),
        adProduct: z.enum(["SPONSORED_PRODUCTS", "SPONSORED_BRANDS", "SPONSORED_DISPLAY"]),
        reportTypeId: z.string().describe("Report type id, e.g. spCampaigns, spSearchTerm, sbCampaigns, sdCampaigns."),
        groupBy: z.array(z.string()).describe('Aggregation level, e.g. ["campaign"] or ["campaign","adGroup"].'),
        columns: z.array(z.string()).min(1).describe("Columns to include. Include \"date\" when timeUnit=DAILY."),
        timeUnit: z.enum(["SUMMARY", "DAILY"]).optional().describe("SUMMARY = one row per entity (default); DAILY = one row per entity per day."),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(logger, "create_report", async (a) =>
      ok(await reporting.createReport(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "get_report_status",
    {
      title: "Check report status",
      description:
        "Check the status of an async report created with create_report. Status flows PENDING → PROCESSING → COMPLETED (or FAILURE with a reason). When COMPLETED, use download_report.",
      inputSchema: {
        profileId: profileIdSchema,
        reportId: z.string().describe("Report id from create_report."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "get_report_status", async (a) =>
      ok(await reporting.getReport(client, resolveProfile(a.profileId), a.reportId)),
    ),
  );

  server.registerTool(
    "download_report",
    {
      title: "Download + validate report data",
      description:
        "Download a COMPLETED report, decompress it, run data-integrity checks (column presence, non-negative metrics, daily date coverage) and return reconciled totals plus a row sample. Large result sets are NOT dumped into chat: totals are computed server-side and the full dataset can be saved to a local JSON file via saveAs. Always present the reconciliation totals rather than re-summing sample rows.",
      inputSchema: {
        profileId: profileIdSchema,
        reportId: z.string(),
        maxRowsInline: z.number().int().min(0).max(500).optional()
          .describe("How many raw rows to return inline (default 50)."),
        saveAs: z.string().optional()
          .describe("Optional filename (no directories) to save the full row set as JSON under REPORT_OUTPUT_DIR."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "download_report", async (a) => {
      const profileId = resolveProfile(a.profileId);
      const status = await reporting.getReport(client, profileId, a.reportId);
      if (status.status !== "COMPLETED" || !status.url) {
        return ok({
          message: `Report is not ready (status: ${status.status}). Poll get_report_status until COMPLETED.`,
          status,
        });
      }
      const { rows, byteSize } = await reporting.downloadReportRows(status.url);

      const cfg = (status.configuration ?? {}) as {
        columns?: string[];
        timeUnit?: string;
      };
      const reconciliation = reconcileReport(rows, {
        requestedColumns: cfg.columns,
        timeUnit: cfg.timeUnit,
        startDate: (status as { startDate?: string }).startDate,
        endDate: (status as { endDate?: string }).endDate,
      });

      let savedTo: string | undefined;
      if (a.saveAs) {
        const safeName = basename(a.saveAs);
        if (safeName !== a.saveAs || !safeName) {
          throw new ValidationError("saveAs must be a plain filename without directories");
        }
        const dir = resolve(config.reportOutputDir);
        await mkdir(dir, { recursive: true });
        savedTo = join(dir, safeName.endsWith(".json") ? safeName : `${safeName}.json`);
        await writeFile(savedTo, JSON.stringify(rows, null, 2), "utf8");
      }

      const maxRows = a.maxRowsInline ?? 50;
      return ok({
        reportId: a.reportId,
        downloadedBytes: byteSize,
        reconciliation,
        savedTo: savedTo ?? null,
        rowsReturned: Math.min(maxRows, rows.length),
        rowsTotal: rows.length,
        rows: rows.slice(0, maxRows),
      });
    }),
  );

  // ── DSP ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "dsp_list_orders",
    {
      title: "List DSP orders",
      description:
        "List Amazon DSP orders (campaigns) for a DSP advertiser profile. REQUIRES DSP entity access on your API client — accounts without a DSP seat get HTTP 403 (an Amazon entitlement, not a server bug).",
      inputSchema: {
        profileId: profileIdSchema,
        startIndex: z.number().int().min(0).optional(),
        count: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "dsp_list_orders", async (a) =>
      ok(await dsp.listOrders(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "dsp_create_report",
    {
      title: "Create DSP report (async)",
      description:
        "Request an async Amazon DSP report (impressions, viewability, conversions, etc.) for a DSP account. Requires DSP API access. Returns a reportId; poll with dsp_get_report until the report has a download location.",
      inputSchema: {
        profileId: profileIdSchema,
        accountId: z.string().describe("DSP advertiser/entity account id from the DSP console."),
        startDate: z.string().describe("YYYY-MM-DD"),
        endDate: z.string().describe("YYYY-MM-DD"),
        type: z.string().optional().describe("Report type, e.g. CAMPAIGN, INVENTORY, AUDIENCE."),
        dimensions: z.array(z.string()).optional().describe("e.g. ORDER, LINE_ITEM, CREATIVE"),
        metrics: z.array(z.string()).optional().describe("Omit for the report type's defaults."),
        timeUnit: z.enum(["SUMMARY", "DAILY"]).optional(),
        format: z.enum(["JSON", "CSV"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(logger, "dsp_create_report", async (a) =>
      ok(await dsp.createDspReport(client, { ...a, profileId: resolveProfile(a.profileId) })),
    ),
  );

  server.registerTool(
    "dsp_get_report",
    {
      title: "Check DSP report status",
      description:
        "Check status of a DSP report. When complete, the response includes a signed download location URL valid for a limited time.",
      inputSchema: {
        profileId: profileIdSchema,
        accountId: z.string(),
        reportId: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "dsp_get_report", async (a) =>
      ok(await dsp.getDspReport(client, resolveProfile(a.profileId), a.accountId, a.reportId)),
    ),
  );

  // ── AMC ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "amc_list_instances",
    {
      title: "List AMC instances",
      description:
        "List Amazon Marketing Cloud instances for an AMC entity. REQUIRES a provisioned AMC instance with this API client allow-listed; otherwise returns 403 (an Amazon entitlement, not a server bug).",
      inputSchema: { ...amcContextSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "amc_list_instances", async (a) => ok(await amc.listInstances(client, a))),
  );

  server.registerTool(
    "amc_list_workflows",
    {
      title: "List AMC workflows",
      description: "List saved AMC SQL workflows on an instance.",
      inputSchema: { ...amcContextSchema, instanceId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "amc_list_workflows", async (a) =>
      ok(await amc.listWorkflows(client, a, a.instanceId)),
    ),
  );

  server.registerTool(
    "amc_create_workflow",
    {
      title: "Create AMC workflow (SQL)",
      description:
        "Save an AMC SQL workflow on an instance. AMC SQL queries clean-room event tables (impressions, clicks, conversions); aggregation thresholds apply — queries returning user-level data are rejected by AMC.",
      inputSchema: {
        ...amcContextSchema,
        instanceId: z.string(),
        workflowId: z.string().describe("Your identifier for this workflow."),
        sqlQuery: z.string().describe("AMC SQL."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(logger, "amc_create_workflow", async (a) => ok(await amc.createWorkflow(client, a))),
  );

  server.registerTool(
    "amc_execute_workflow",
    {
      title: "Execute AMC workflow (async)",
      description:
        "Start an execution of a saved AMC workflow over a time window. Returns an execution id; poll with amc_get_execution, then fetch results with amc_get_download_urls.",
      inputSchema: {
        ...amcContextSchema,
        instanceId: z.string(),
        workflowId: z.string(),
        timeWindowStart: z.string().optional().describe("ISO-8601, e.g. 2026-05-01T00:00:00Z"),
        timeWindowEnd: z.string().optional(),
        timeWindowType: z.string().optional().describe("e.g. EXPLICIT, MOST_RECENT_WEEK — see AMC docs."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(logger, "amc_execute_workflow", async (a) =>
      ok(await amc.createWorkflowExecution(client, a)),
    ),
  );

  server.registerTool(
    "amc_get_execution",
    {
      title: "Check AMC execution status",
      description: "Check the status of an AMC workflow execution (PENDING/RUNNING/SUCCEEDED/FAILED).",
      inputSchema: { ...amcContextSchema, instanceId: z.string(), executionId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "amc_get_execution", async (a) =>
      ok(await amc.getWorkflowExecution(client, a, a.instanceId, a.executionId)),
    ),
  );

  server.registerTool(
    "amc_get_download_urls",
    {
      title: "Get AMC result download URLs",
      description:
        "Get signed download URLs (CSV) for a SUCCEEDED AMC workflow execution. URLs expire after a short period.",
      inputSchema: { ...amcContextSchema, instanceId: z.string(), executionId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(logger, "amc_get_download_urls", async (a) =>
      ok(await amc.getExecutionDownloadUrls(client, a, a.instanceId, a.executionId)),
    ),
  );
}

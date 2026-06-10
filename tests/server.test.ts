import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { jsonResponse, silentLogger, testConfig, tokenResponse } from "./helpers.js";

const PROFILE = {
  profileId: 111111,
  countryCode: "US",
  currencyCode: "USD",
  timezone: "America/Los_Angeles",
  accountInfo: { marketplaceStringId: "ATVPDKIKX0DER", id: "A1SELLER", type: "seller" },
};

/** End-to-end over the MCP wire protocol with the Amazon API mocked at fetch level. */
async function connect(fetchFn: typeof fetch) {
  const { server } = buildServer({ config: testConfig(), logger: silentLogger, fetchFn });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function routedFetch(routes: Array<[RegExp, () => Response]>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [re, make] of routes) {
      if (re.test(url)) return make();
    }
    throw new Error(`unmocked fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe("amazon-ads-mcp server", () => {
  it("exposes the expected tool surface", async () => {
    const client = await connect(routedFetch([]));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "get_profiles",
        "health_check",
        "sp_list_campaigns",
        "sp_list_ad_groups",
        "sp_list_keywords",
        "sp_list_targets",
        "sp_list_product_ads",
        "sb_list_campaigns",
        "sb_list_ad_groups",
        "sd_list_campaigns",
        "sd_list_ad_groups",
        "create_report",
        "get_report_status",
        "download_report",
        "dsp_list_orders",
        "dsp_create_report",
        "dsp_get_report",
        "amc_list_instances",
        "amc_list_workflows",
        "amc_create_workflow",
        "amc_execute_workflow",
        "amc_get_execution",
        "amc_get_download_urls",
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
    }
  });

  it("get_profiles returns live API data over the wire", async () => {
    const client = await connect(
      routedFetch([
        [/auth\/o2\/token/, () => tokenResponse()],
        [/\/v2\/profiles/, () => jsonResponse([PROFILE])],
      ]),
    );
    const result = await client.callTool({ name: "get_profiles", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(text)).toEqual([PROFILE]);
    expect(result.isError).toBeFalsy();
  });

  it("surfaces Amazon API errors as isError tool results, not protocol failures", async () => {
    const client = await connect(
      routedFetch([
        [/auth\/o2\/token/, () => tokenResponse()],
        [
          /\/sp\/campaigns\/list/,
          () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 403 }),
        ],
      ]),
    );
    const result = await client.callTool({ name: "sp_list_campaigns", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("403");
  });

  it("create_report validates dates before calling Amazon", async () => {
    const fetchFn = routedFetch([[/auth\/o2\/token/, () => tokenResponse()]]);
    const client = await connect(fetchFn);
    const result = await client.callTool({
      name: "create_report",
      arguments: {
        startDate: "2026-06-01",
        endDate: "2026-05-01", // inverted
        adProduct: "SPONSORED_PRODUCTS",
        reportTypeId: "spCampaigns",
        groupBy: ["campaign"],
        columns: ["campaignId", "impressions"],
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/after endDate/);
  });
});

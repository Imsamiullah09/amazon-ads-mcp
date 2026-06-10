import type { AdsHttpClient } from "../http/client.js";

/**
 * Amazon Marketing Cloud (AMC) reporting API.
 *
 * IMPORTANT ACCESS LIMITATIONS:
 *  - AMC requires a provisioned AMC instance and your LwA client allow-listed
 *    for that instance. Without it, every call here returns 403.
 *  - AMC calls are NOT scoped by sponsored-ads profile. They require the AMC
 *    entity id (Amazon-Advertising-API-AdvertiserId header) and marketplace id
 *    (Amazon-Advertising-API-MarketplaceId header) from your AMC onboarding.
 *  - Endpoint shapes follow the AMC Reporting API ("workflows" +
 *    "workflowExecutions"). Verify paths against the AMC docs for your
 *    instance generation before production use:
 *    https://advertising.amazon.com/API/docs/en-us/amc-reporting
 *
 * Results are returned via signed download URLs (CSV), like Reporting v3.
 */
export interface AmcContext {
  /** AMC entity id, e.g. "ENTITY1ABC..." */
  entityId: string;
  /** Marketplace id, e.g. "ATVPDKIKX0DER" for amazon.com */
  marketplaceId: string;
}

function amcHeaders(ctx: AmcContext): Record<string, string> {
  return {
    "Amazon-Advertising-API-AdvertiserId": ctx.entityId,
    "Amazon-Advertising-API-MarketplaceId": ctx.marketplaceId,
  };
}

export async function listInstances(
  client: AdsHttpClient,
  ctx: AmcContext,
): Promise<unknown> {
  return client.request<unknown>({
    method: "GET",
    path: "/amc/instances",
    headers: amcHeaders(ctx),
  });
}

export interface AmcCreateWorkflowParams extends AmcContext {
  instanceId: string;
  workflowId: string;
  /** AMC SQL query. */
  sqlQuery: string;
  /** Optional output format, defaults to CSV server-side. */
  outputFormat?: string;
}

export async function createWorkflow(
  client: AdsHttpClient,
  p: AmcCreateWorkflowParams,
): Promise<unknown> {
  return client.request<unknown>({
    method: "POST",
    path: `/amc/reporting/${encodeURIComponent(p.instanceId)}/workflows`,
    body: {
      workflowId: p.workflowId,
      sqlQuery: p.sqlQuery,
      ...(p.outputFormat ? { outputFormat: p.outputFormat } : {}),
    },
    headers: amcHeaders(p),
    cacheTtlMs: 0,
  });
}

export async function listWorkflows(
  client: AdsHttpClient,
  ctx: AmcContext,
  instanceId: string,
): Promise<unknown> {
  return client.request<unknown>({
    method: "GET",
    path: `/amc/reporting/${encodeURIComponent(instanceId)}/workflows`,
    headers: amcHeaders(ctx),
  });
}

export interface AmcExecuteParams extends AmcContext {
  instanceId: string;
  workflowId: string;
  /** ISO-8601 timestamps or AMC relative markers per AMC docs. */
  timeWindowStart?: string;
  timeWindowEnd?: string;
  timeWindowType?: string;
  parameterValues?: Record<string, unknown>;
}

export async function createWorkflowExecution(
  client: AdsHttpClient,
  p: AmcExecuteParams,
): Promise<unknown> {
  return client.request<unknown>({
    method: "POST",
    path: `/amc/reporting/${encodeURIComponent(p.instanceId)}/workflowExecutions`,
    body: {
      workflowId: p.workflowId,
      ...(p.timeWindowStart ? { timeWindowStart: p.timeWindowStart } : {}),
      ...(p.timeWindowEnd ? { timeWindowEnd: p.timeWindowEnd } : {}),
      ...(p.timeWindowType ? { timeWindowType: p.timeWindowType } : {}),
      ...(p.parameterValues ? { parameterValues: p.parameterValues } : {}),
    },
    headers: amcHeaders(p),
    cacheTtlMs: 0,
  });
}

export async function getWorkflowExecution(
  client: AdsHttpClient,
  ctx: AmcContext,
  instanceId: string,
  executionId: string,
): Promise<unknown> {
  return client.request<unknown>({
    method: "GET",
    path: `/amc/reporting/${encodeURIComponent(instanceId)}/workflowExecutions/${encodeURIComponent(executionId)}`,
    headers: amcHeaders(ctx),
    cacheTtlMs: 0,
  });
}

export async function getExecutionDownloadUrls(
  client: AdsHttpClient,
  ctx: AmcContext,
  instanceId: string,
  executionId: string,
): Promise<unknown> {
  return client.request<unknown>({
    method: "GET",
    path: `/amc/reporting/${encodeURIComponent(instanceId)}/workflowExecutions/${encodeURIComponent(executionId)}/downloadUrls`,
    headers: amcHeaders(ctx),
    cacheTtlMs: 0,
  });
}

import type { AdsHttpClient } from "../http/client.js";

/**
 * Amazon DSP reporting + entity reads.
 *
 * IMPORTANT ACCESS LIMITATION: DSP APIs require a DSP seat (advertiser or
 * agency entity) and explicit API access for that entity. Accounts without
 * DSP access receive 403s here — that is an Amazon-side entitlement, not a
 * bug in this server.
 *
 * DSP reports are scoped by DSP *account id* (advertiser/entity id from the
 * DSP console), not by the sponsored-ads profile id.
 * https://advertising.amazon.com/API/docs/en-us/dsp-reports-beta-3p/
 */
const REPORT_MEDIA = "application/vnd.dspcreatereports.v3+json";
const REPORT_GET_MEDIA = "application/vnd.dspgetreports.v3+json";
const ORDERS_MEDIA = "application/vnd.dsporders.v2.3+json";

export interface DspCreateReportParams {
  profileId: string;
  /** DSP advertiser/entity account id, e.g. from the DSP console URL. */
  accountId: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  /** e.g. CAMPAIGN, INVENTORY, AUDIENCE, PRODUCTS, TECHNOLOGY */
  type?: string;
  dimensions?: string[];
  metrics?: string[];
  timeUnit?: "SUMMARY" | "DAILY";
  format?: "JSON" | "CSV";
}

export interface DspReportStatus {
  reportId: string;
  status: string;
  format?: string;
  location?: string | null;
  expiration?: number | null;
  [k: string]: unknown;
}

export async function createDspReport(
  client: AdsHttpClient,
  p: DspCreateReportParams,
): Promise<DspReportStatus> {
  const body: Record<string, unknown> = {
    startDate: p.startDate,
    endDate: p.endDate,
    format: p.format ?? "JSON",
    timeUnit: p.timeUnit ?? "SUMMARY",
    ...(p.type ? { type: p.type } : {}),
    ...(p.dimensions?.length ? { dimensions: p.dimensions } : {}),
    ...(p.metrics?.length ? { metrics: p.metrics } : {}),
  };
  return client.request<DspReportStatus>({
    method: "POST",
    path: `/accounts/${encodeURIComponent(p.accountId)}/dsp/reports`,
    body,
    profileId: p.profileId,
    accept: REPORT_MEDIA,
    cacheTtlMs: 0,
  });
}

export async function getDspReport(
  client: AdsHttpClient,
  profileId: string,
  accountId: string,
  reportId: string,
): Promise<DspReportStatus> {
  return client.request<DspReportStatus>({
    method: "GET",
    path: `/accounts/${encodeURIComponent(accountId)}/dsp/reports/${encodeURIComponent(reportId)}`,
    profileId,
    accept: REPORT_GET_MEDIA,
    cacheTtlMs: 0,
  });
}

export interface DspListOrdersParams {
  profileId: string;
  startIndex?: number;
  count?: number;
}

export async function listOrders(
  client: AdsHttpClient,
  p: DspListOrdersParams,
): Promise<unknown> {
  return client.request<unknown>({
    method: "GET",
    path: "/dsp/orders",
    query: { startIndex: p.startIndex, count: p.count },
    profileId: p.profileId,
    accept: ORDERS_MEDIA,
  });
}

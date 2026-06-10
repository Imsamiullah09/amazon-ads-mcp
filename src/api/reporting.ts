import { gunzipSync } from "node:zlib";
import type { AdsHttpClient } from "../http/client.js";
import { AdsApiError, ValidationError } from "../http/errors.js";

/**
 * Reporting v3 (unified async reporting for SP / SB / SD).
 * Workflow: create → poll status → download from the signed URL Amazon
 * returns when status is COMPLETED. Reports are gzip-compressed JSON.
 * https://advertising.amazon.com/API/docs/en-us/reporting/v3/overview
 */
const CREATE_MEDIA = "application/vnd.createasyncreportrequest.v3+json";

export type AdProduct =
  | "SPONSORED_PRODUCTS"
  | "SPONSORED_BRANDS"
  | "SPONSORED_DISPLAY";

export interface CreateReportParams {
  profileId: string;
  name?: string;
  /** YYYY-MM-DD (advertiser-profile timezone). */
  startDate: string;
  /** YYYY-MM-DD inclusive. */
  endDate: string;
  adProduct: AdProduct;
  /** e.g. spCampaigns, spTargeting, spSearchTerm, sbCampaigns, sdCampaigns */
  reportTypeId: string;
  /** e.g. ["campaign"], ["campaign","adGroup"] */
  groupBy: string[];
  /** Metric/dimension columns; validated against the data on download. */
  columns: string[];
  timeUnit?: "SUMMARY" | "DAILY";
  filters?: Array<{ field: string; values: string[] }>;
}

export interface ReportStatus {
  reportId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILURE" | string;
  name?: string;
  url?: string | null;
  urlExpiresAt?: string | null;
  fileSize?: number | null;
  failureReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  configuration?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateRange(startDate: string, endDate: string): void {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new ValidationError("Dates must be YYYY-MM-DD");
  }
  if (startDate > endDate) {
    throw new ValidationError(`startDate ${startDate} is after endDate ${endDate}`);
  }
}

export async function createReport(
  client: AdsHttpClient,
  p: CreateReportParams,
): Promise<ReportStatus> {
  validateDateRange(p.startDate, p.endDate);
  if (!p.columns.length) throw new ValidationError("columns must not be empty");
  if (!p.groupBy.length) throw new ValidationError("groupBy must not be empty");

  const body = {
    name: p.name ?? `mcp-${p.reportTypeId}-${p.startDate}-${p.endDate}`,
    startDate: p.startDate,
    endDate: p.endDate,
    configuration: {
      adProduct: p.adProduct,
      groupBy: p.groupBy,
      columns: p.columns,
      reportTypeId: p.reportTypeId,
      timeUnit: p.timeUnit ?? "SUMMARY",
      format: "GZIP_JSON",
      ...(p.filters?.length ? { filters: p.filters } : {}),
    },
  };

  return client.request<ReportStatus>({
    method: "POST",
    path: "/reporting/reports",
    body,
    profileId: p.profileId,
    contentType: CREATE_MEDIA,
    accept: CREATE_MEDIA,
    cacheTtlMs: 0,
  });
}

export async function getReport(
  client: AdsHttpClient,
  profileId: string,
  reportId: string,
): Promise<ReportStatus> {
  return client.request<ReportStatus>({
    method: "GET",
    path: `/reporting/reports/${encodeURIComponent(reportId)}`,
    profileId,
    cacheTtlMs: 0,
  });
}

export interface DownloadedReport {
  rows: Record<string, unknown>[];
  byteSize: number;
}

/**
 * Download and decompress a completed report from its signed URL.
 * The URL is S3-signed: it must be fetched WITHOUT Amazon Ads auth headers
 * (sending Authorization to S3 causes a signature mismatch).
 */
export async function downloadReportRows(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<DownloadedReport> {
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new AdsApiError(
      `Report download failed (the signed URL may have expired — re-fetch report status): HTTP ${res.status}`,
      res.status,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let json: string;
  try {
    json = gunzipSync(buf).toString("utf8");
  } catch {
    // Some responses arrive already decompressed depending on the fetch stack.
    json = buf.toString("utf8");
  }
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch (err) {
    throw new ValidationError(
      `Report payload is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(rows)) {
    throw new ValidationError("Report payload is not a JSON array of rows");
  }
  return { rows: rows as Record<string, unknown>[], byteSize: buf.byteLength };
}

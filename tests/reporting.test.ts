import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  downloadReportRows,
  validateDateRange,
} from "../src/api/reporting.js";
import { ValidationError } from "../src/http/errors.js";

describe("validateDateRange", () => {
  it("accepts a valid range", () => {
    expect(() => validateDateRange("2026-05-01", "2026-05-31")).not.toThrow();
  });
  it("rejects malformed dates", () => {
    expect(() => validateDateRange("05/01/2026", "2026-05-31")).toThrow(ValidationError);
  });
  it("rejects inverted ranges", () => {
    expect(() => validateDateRange("2026-06-01", "2026-05-01")).toThrow(ValidationError);
  });
});

describe("downloadReportRows", () => {
  const rows = [
    { campaignId: "1", impressions: 100, clicks: 5, cost: 12.5 },
    { campaignId: "2", impressions: 50, clicks: 1, cost: 2.0 },
  ];

  it("downloads and decompresses gzip JSON", async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify(rows)));
    const fetchFn = vi.fn(async () => new Response(gz));
    const result = await downloadReportRows("https://signed.example/r", fetchFn as unknown as typeof fetch);
    expect(result.rows).toEqual(rows);
    expect(result.byteSize).toBe(gz.byteLength);
  });

  it("handles payloads the fetch stack already decompressed", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(rows)));
    const result = await downloadReportRows("https://signed.example/r", fetchFn as unknown as typeof fetch);
    expect(result.rows).toEqual(rows);
  });

  it("fails clearly on expired signed URLs", async () => {
    const fetchFn = vi.fn(async () => new Response("denied", { status: 403 }));
    await expect(
      downloadReportRows("https://signed.example/r", fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/expired|403/);
  });

  it("rejects non-array payloads", async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify({ not: "rows" })));
    const fetchFn = vi.fn(async () => new Response(gz));
    await expect(
      downloadReportRows("https://signed.example/r", fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(ValidationError);
  });
});

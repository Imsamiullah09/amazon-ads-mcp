import { describe, expect, it } from "vitest";
import { reconcileReport } from "../src/validation/reconcile.js";

describe("reconcileReport", () => {
  it("computes totals across numeric columns", () => {
    const result = reconcileReport([
      { campaignId: "1", impressions: 100, clicks: 5, cost: 12.5 },
      { campaignId: "2", impressions: 50, clicks: 1, cost: 2.25 },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.totals.impressions).toBe(150);
    expect(result.totals.clicks).toBe(6);
    expect(result.totals.cost).toBeCloseTo(14.75);
    expect(result.passed).toBe(true);
  });

  it("flags requested columns missing from the data", () => {
    const result = reconcileReport(
      [{ campaignId: "1", impressions: 10 }],
      { requestedColumns: ["campaignId", "impressions", "sales14d"] },
    );
    expect(result.missingColumns).toEqual(["sales14d"]);
    expect(result.passed).toBe(false);
  });

  it("fails on negative invariant metrics", () => {
    const result = reconcileReport([{ campaignId: "1", impressions: -5 }]);
    expect(result.passed).toBe(false);
    expect(result.anomalies[0]).toMatch(/negative impressions/);
  });

  it("reports daily date coverage gaps without failing", () => {
    const result = reconcileReport(
      [
        { date: "2026-05-01", impressions: 10 },
        { date: "2026-05-03", impressions: 20 },
      ],
      { timeUnit: "DAILY", startDate: "2026-05-01", endDate: "2026-05-03" },
    );
    expect(result.dateCoverage?.expectedDays).toBe(3);
    expect(result.dateCoverage?.missingDates).toEqual(["2026-05-02"]);
    expect(result.passed).toBe(true); // gaps may be zero-activity days
  });

  it("handles empty reports", () => {
    const result = reconcileReport([], { requestedColumns: ["impressions"] });
    expect(result.rowCount).toBe(0);
    expect(result.passed).toBe(true);
  });
});

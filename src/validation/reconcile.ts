/**
 * Data-integrity checks for downloaded reports.
 *
 * The MCP server cannot independently re-derive Amazon's numbers, so
 * "reconciliation" here means structural + sanity validation that catches
 * truncated downloads, schema drift, and obviously corrupt data before the
 * model reasons over it:
 *  - every requested column is present in the data
 *  - numeric metrics are finite and non-negative where that is invariant
 *  - daily reports fully cover the requested date range (no silent gaps)
 *  - totals are computed once, here, so the model never has to sum rows
 */
export interface ReconciliationResult {
  rowCount: number;
  /** Sum of each numeric column across all rows. */
  totals: Record<string, number>;
  /** Columns requested but absent from every row. */
  missingColumns: string[];
  /** Distinct dates present (only when rows carry a `date` field). */
  dateCoverage?: {
    expectedDays: number;
    presentDays: number;
    missingDates: string[];
  };
  anomalies: string[];
  passed: boolean;
}

/** Metrics that can never legitimately be negative. */
const NON_NEGATIVE = new Set([
  "impressions",
  "clicks",
  "cost",
  "spend",
  "purchases",
  "unitsSold",
  "sales",
]);

export function reconcileReport(
  rows: Record<string, unknown>[],
  opts: {
    requestedColumns?: string[];
    startDate?: string;
    endDate?: string;
    timeUnit?: string;
  } = {},
): ReconciliationResult {
  const anomalies: string[] = [];
  const totals: Record<string, number> = {};
  const seenColumns = new Set<string>();
  const seenDates = new Set<string>();

  for (const [i, row] of rows.entries()) {
    for (const [key, value] of Object.entries(row)) {
      seenColumns.add(key);
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          anomalies.push(`row ${i}: non-finite value in "${key}"`);
          continue;
        }
        totals[key] = (totals[key] ?? 0) + value;
        if (NON_NEGATIVE.has(key) && value < 0) {
          anomalies.push(`row ${i}: negative ${key} (${value})`);
        }
      }
    }
    const d = row.date;
    if (typeof d === "string") seenDates.add(d.slice(0, 10));
  }

  // Column presence is only assessable when there is data.
  const missingColumns =
    rows.length === 0
      ? []
      : (opts.requestedColumns ?? []).filter((c) => !seenColumns.has(c));
  if (missingColumns.length > 0) {
    anomalies.push(`columns missing from data: ${missingColumns.join(", ")}`);
  }

  let dateCoverage: ReconciliationResult["dateCoverage"];
  if (
    opts.timeUnit === "DAILY" &&
    opts.startDate &&
    opts.endDate &&
    rows.length > 0
  ) {
    const expected = enumerateDates(opts.startDate, opts.endDate);
    const missingDates = expected.filter((d) => !seenDates.has(d));
    dateCoverage = {
      expectedDays: expected.length,
      presentDays: seenDates.size,
      missingDates,
    };
    // Missing days can be legitimate (no activity), so flag, don't fail.
    if (missingDates.length > 0) {
      anomalies.push(
        `no rows for ${missingDates.length} of ${expected.length} requested days (may simply be days with zero activity): ${missingDates.slice(0, 10).join(", ")}${missingDates.length > 10 ? "…" : ""}`,
      );
    }
  }

  const hardFailures = anomalies.filter(
    (a) => a.includes("non-finite") || a.includes("negative"),
  );

  return {
    rowCount: rows.length,
    totals: roundTotals(totals),
    missingColumns,
    dateCoverage,
    anomalies,
    passed: hardFailures.length === 0 && missingColumns.length === 0,
  };
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (d <= endD) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function roundTotals(totals: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) {
    out[k] = Math.round(v * 10_000) / 10_000;
  }
  return out;
}

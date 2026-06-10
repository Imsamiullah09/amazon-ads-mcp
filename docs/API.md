# Tool Reference

All tools are **read-only** against your advertising data (the report/workflow "create" tools create report jobs, never campaign changes). Unless noted, `profileId` is optional when `AMAZON_ADS_PROFILE_ID` is set.

Errors are returned as tool results with `isError: true` and include the HTTP status and Amazon's `x-amz-request-id` for support escalation.

## Profiles & diagnostics

### `get_profiles`
List advertiser profiles for the configured region. **Call this first** — every other tool is scoped by a `profileId` from here.
No parameters. Returns `profileId`, `countryCode`, `currencyCode`, `timezone`, `accountInfo`.

### `health_check`
Refreshes the LwA token, lists profiles, reports latency and effective config (secrets redacted). Use to diagnose setup issues.

## Sponsored Products (v3)

All SP list tools accept: `profileId?`, `stateFilter?` (`ENABLED|PAUSED|ARCHIVED`), `campaignIds?`, `maxResults?`, `nextToken?`. Keyword/target/product-ad tools also accept `adGroupIds?`. Paginate by passing back `nextToken`.

| Tool | Returns |
|---|---|
| `sp_list_campaigns` | Campaigns: budget, targeting type, state, dates |
| `sp_list_ad_groups` | Ad groups: default bids, states |
| `sp_list_keywords` | Keywords: match type, bid, state |
| `sp_list_targets` | Targeting clauses: product/category/auto expressions |
| `sp_list_product_ads` | Advertised ASINs/SKUs per ad group |

> Entity endpoints return **structure, not metrics**. For impressions/clicks/spend/sales use the reporting tools.

## Sponsored Brands (v4)

`sb_list_campaigns`, `sb_list_ad_groups` — same parameter shape as SP.

## Sponsored Display

`sd_list_campaigns`, `sd_list_ad_groups` — SD uses `startIndex`/`count` pagination and lower-case `stateFilter` values (`enabled|paused|archived`).

## Reporting v3 (performance metrics for SP / SB / SD)

### `create_report`
Create an async report. Returns a `reportId` immediately.

| Param | Notes |
|---|---|
| `startDate` / `endDate` | `YYYY-MM-DD`, profile timezone; most types allow ~95-day lookback |
| `adProduct` | `SPONSORED_PRODUCTS` \| `SPONSORED_BRANDS` \| `SPONSORED_DISPLAY` |
| `reportTypeId` | e.g. `spCampaigns`, `spTargeting`, `spSearchTerm`, `spAdvertisedProduct`, `sbCampaigns`, `sdCampaigns` |
| `groupBy` | e.g. `["campaign"]`, `["campaign","adGroup"]` |
| `columns` | Metrics/dimensions; include `date` when `timeUnit=DAILY` |
| `timeUnit` | `SUMMARY` (default) or `DAILY` |

Useful column sets (`spCampaigns`): `campaignId, campaignName, impressions, clicks, cost, purchases14d, sales14d, costPerClick, clickThroughRate`.

### `get_report_status`
Poll until `status` is `COMPLETED` (typically 1–15 minutes; large accounts can take longer). `FAILURE` includes `failureReason`.

### `download_report`
Downloads the gzip JSON from the signed URL, validates it, and returns:

```jsonc
{
  "reconciliation": {
    "rowCount": 412,
    "totals": { "impressions": 1882345, "clicks": 9251, "cost": 8123.44 },
    "missingColumns": [],
    "dateCoverage": { "expectedDays": 30, "presentDays": 30, "missingDates": [] },
    "anomalies": [],
    "passed": true
  },
  "rowsTotal": 412,
  "rowsReturned": 50,          // bounded inline sample (maxRowsInline)
  "rows": [ /* sample */ ],
  "savedTo": "/…/reports-output/may.json"  // when saveAs given
}
```

`saveAs` accepts a **plain filename only** (no directories); files land in `REPORT_OUTPUT_DIR`. Quote `reconciliation.totals` — never re-sum the truncated sample.

## Amazon DSP *(requires DSP entitlement)*

| Tool | Purpose |
|---|---|
| `dsp_list_orders` | List DSP orders for a DSP profile |
| `dsp_create_report` | Async DSP report (`accountId` = DSP entity id, plus dates, type, dimensions, metrics) |
| `dsp_get_report` | Poll status; completed reports expose a signed download location |

A 403 here means your API client lacks DSP access — an Amazon entitlement issue, not a bug.

## Amazon Marketing Cloud *(requires provisioned AMC instance)*

All AMC tools require `entityId` (AMC entity, sent as `Amazon-Advertising-API-AdvertiserId`) and `marketplaceId` — both from your AMC onboarding. AMC enforces clean-room aggregation thresholds; queries returning user-level data are rejected by AMC itself.

| Tool | Purpose |
|---|---|
| `amc_list_instances` | List AMC instances for the entity |
| `amc_list_workflows` | List saved SQL workflows on an instance |
| `amc_create_workflow` | Save a SQL workflow |
| `amc_execute_workflow` | Run a workflow over a time window → execution id |
| `amc_get_execution` | Poll execution status |
| `amc_get_download_urls` | Signed CSV URLs for a succeeded execution |

> AMC endpoint shapes evolve by instance generation. These tools follow the AMC Reporting API; verify against current AMC docs before production reliance.

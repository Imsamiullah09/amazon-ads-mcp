# Example prompts

These work in Claude Desktop / Claude Code once the server is connected. Claude chains the tools itself — you just ask.

## Getting oriented

> Run a health check on my Amazon Ads connection and list my profiles.

> Which advertiser profiles do I have, and what currency/timezone is each in?

## Campaign structure

> List all enabled Sponsored Products campaigns with their daily budgets, sorted by budget.

> Show the keywords (with bids and match types) in campaign 123456789.

> Which ASINs am I advertising in my "Spring Sale" campaign's ad groups?

> Compare my Sponsored Brands and Sponsored Display campaign counts and states.

## Performance (async reports — Claude will create, poll, and download)

> Create a daily Sponsored Products campaign report for the last 30 days with impressions, clicks, cost, purchases14d and sales14d. When it's ready, summarize ACOS by campaign and flag anything above 40%.

> Pull a search-term report for May. Which queries got more than 20 clicks but zero purchases? Save the full data as may-search-terms.json.

> Run a SUMMARY spTargeting report for last week and tell me my top 10 targets by sales.

Tips:
- Reports take 1–15 minutes; Claude polls `get_report_status` between steps.
- Ask Claude to quote the **reconciliation totals** (it's instructed to) — they're computed server-side from the full dataset.

## DSP (requires DSP entitlement)

> List my DSP orders, then create a DAILY campaign report for June 1–7 and show me the status.

## AMC (requires a provisioned AMC instance)

> Using entity ENTITY1ABC and marketplace ATVPDKIKX0DER, list my AMC instances.

> Create an AMC workflow called `ntb_by_campaign` on instance amc1abc with this SQL: …, execute it for last week, and give me the download URLs when it succeeds.

# User Guide — from zero to asking Claude about your Amazon Ads

This guide takes you from nothing to chatting with your Amazon Ads data. No coding required — just careful copy-pasting.

**The journey has 4 parts:**

1. Get Amazon Ads API credentials (one-time, ~1–3 days because Amazon must approve you)
2. Install this server (~5 minutes)
3. Connect it to Claude (~5 minutes)
4. Start asking questions

---

## Part 1 — Get Amazon Ads API credentials (one-time)

You need three values from Amazon: a **Client ID**, a **Client Secret**, and a **Refresh Token**. This is Amazon's standard API onboarding — every tool that reads ads data requires it.

### 1.1 Prerequisites

- An active **Amazon Ads account** (you advertise as a seller, vendor, or agency).
- Sign-in access to that account.

### 1.2 Apply for API access

1. Go to the [Amazon Ads API onboarding page](https://advertising.amazon.com/API/docs/en-us/onboarding/overview) and follow the **"Apply for access"** flow (you'll sign in with the email that manages your ads account).
2. As part of this you create (or link) a **Login with Amazon (LwA) security profile** in the [Amazon Developer Console](https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html) — this profile *is* your API identity.
3. Wait for the approval email. This typically takes 1–3 business days.

### 1.3 Collect your Client ID and Client Secret

1. Open the [LwA Console](https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html) → your security profile.
2. Copy:
   - **Client ID** — looks like `amzn1.application-oa2-client.abc123…`
   - **Client Secret** — a long random string. Treat it like a password.
3. Under **Web Settings → Allowed Return URLs**, add a redirect URL. If you have no website, `https://amazon.com` works for the manual flow below.

### 1.4 Generate your Refresh Token

This authorizes the API client to read **your** ads data. You do it once; the refresh token works long-term.

**Step A — visit the authorization URL** (replace `YOUR_CLIENT_ID` and `YOUR_RETURN_URL`; use the domain for your region):

| Your region | Authorization domain | Token endpoint |
|---|---|---|
| North America | `www.amazon.com` | `https://api.amazon.com/auth/o2/token` |
| Europe | `eu.account.amazon.com` | `https://api.amazon.co.uk/auth/o2/token` |
| Far East (JP/AU/SG) | `apac.account.amazon.com` | `https://api.amazon.co.jp/auth/o2/token` |

```
https://www.amazon.com/ap/oa?client_id=YOUR_CLIENT_ID&scope=advertising::campaign_management&response_type=code&redirect_uri=YOUR_RETURN_URL
```

**Step B — approve access.** Sign in with your ads account and click Allow. You'll land on your return URL with `?code=XXXXX` in the address bar. **Copy that code quickly — it expires in about 5 minutes.**

**Step C — exchange the code for a refresh token.** In a terminal (replace all four values; use your region's token endpoint):

```bash
curl -s -X POST https://api.amazon.com/auth/o2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=THE_CODE&redirect_uri=YOUR_RETURN_URL&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
```

The JSON response contains `"refresh_token": "Atzr|..."` — **save it somewhere safe.** That's your third credential.

> 🔒 Your Client Secret and Refresh Token grant read access to your advertising data. Never share them, never commit them to git, never paste them into chat messages.

---

## Part 2 — Install the server (~5 minutes)

### 2.1 Install Node.js

You need Node.js version 20 or newer. Download from [nodejs.org](https://nodejs.org) (choose LTS). Verify in a terminal:

```bash
node --version   # should print v20.x or higher
```

### 2.2 Download and build

```bash
git clone https://github.com/Imsamiullah09/amazon-ads-mcp.git
cd amazon-ads-mcp
npm ci
npm run build
```

(No git? Click **Code → Download ZIP** on the GitHub page, unzip, and run the last two commands inside the folder.)

Note the **full path** of the folder — you'll need it next. Get it with `pwd` (Mac/Linux) or `cd` (Windows).

---

## Part 3 — Connect to Claude (~5 minutes)

### 3.1 Claude Desktop

1. Open Claude Desktop → **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`.
2. Add this block (merge it if `mcpServers` already exists), filling in your three credentials and the real path:

```json
{
  "mcpServers": {
    "amazon-ads": {
      "command": "node",
      "args": ["/FULL/PATH/TO/amazon-ads-mcp/dist/index.js"],
      "env": {
        "AMAZON_ADS_CLIENT_ID": "amzn1.application-oa2-client.YOUR_ID",
        "AMAZON_ADS_CLIENT_SECRET": "YOUR_SECRET",
        "AMAZON_ADS_REFRESH_TOKEN": "Atzr|YOUR_REFRESH_TOKEN",
        "AMAZON_ADS_REGION": "NA"
      }
    }
  }
}
```

   - `AMAZON_ADS_REGION`: `NA` (Americas), `EU` (Europe/Middle East/India), or `FE` (Japan/Australia/Singapore). **Must match where you generated the refresh token.**
   - On Windows, write the path with double backslashes: `"C:\\Users\\you\\amazon-ads-mcp\\dist\\index.js"`.

3. **Quit Claude Desktop completely and reopen it.**
4. You should see **amazon-ads** under the tools (🔌 / sliders) icon.

### 3.2 First conversation — verify it works

Ask Claude:

> **"Run a health check on my Amazon Ads connection."**

You should get back your region, latency, and how many profiles are accessible. Then:

> **"List my advertiser profiles."**

Pick the `profileId` of the account you use most and add it to the config as `"AMAZON_ADS_PROFILE_ID": "1234567890"` (then restart Claude again). With a default profile set, you never have to mention profile IDs in conversation.

### 3.3 Alternative: Claude Code (terminal)

```bash
claude mcp add amazon-ads \
  -e AMAZON_ADS_CLIENT_ID=… -e AMAZON_ADS_CLIENT_SECRET=… \
  -e AMAZON_ADS_REFRESH_TOKEN=… -e AMAZON_ADS_REGION=NA \
  -- node /FULL/PATH/TO/amazon-ads-mcp/dist/index.js
```

### 3.4 Alternative: Docker

```bash
cp .env.example .env    # fill in your credentials
docker compose up -d    # MCP endpoint at http://127.0.0.1:3000/mcp
```

---

## Part 4 — Using it day to day

Just talk. Claude picks the right tools and chains them. Examples:

**Account structure (instant):**
- "Show all enabled Sponsored Products campaigns with their daily budgets."
- "List the keywords and bids in campaign 123456789."
- "Which ASINs am I advertising right now?"

**Performance (Claude creates a report, waits 1–15 minutes, downloads it):**
- "Create a daily Sponsored Products report for the last 30 days with impressions, clicks, cost, purchases14d and sales14d, then summarize ACOS by campaign."
- "Pull last month's search-term report and find queries with 20+ clicks but zero purchases. Save the full data as search-terms.json."

Two habits worth forming:
- Performance numbers come from **reports**, not the campaign lists — campaign lists show structure (budgets, states), reports show metrics (spend, sales).
- The server returns **reconciled totals computed from the full dataset** — those are the numbers to trust, and Claude is instructed to quote them.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Server doesn't appear in Claude | JSON syntax error in the config (missing comma/quote), or wrong file path. Validate the JSON and use an absolute path to `dist/index.js`. Fully quit and reopen Claude. |
| `Invalid configuration: … Required` | One of the three credential env vars is missing/misspelled in the config. |
| `Token refresh rejected … invalid_grant` | Refresh token doesn't match the Client ID/Secret, or wrong `AMAZON_ADS_REGION` for where the token was issued. Regenerate the token (Part 1.4). |
| `403` on every call | Your LwA profile isn't approved for the Ads API yet, or you're calling the wrong region. |
| `403` only on DSP or AMC tools | Those require extra Amazon entitlements (a DSP seat / a provisioned AMC instance). Normal advertisers won't have them — everything else still works. |
| Report stuck `PENDING` for a long time | Large accounts can take up to a few hours on Amazon's side. Ask Claude to check again later — the reportId stays valid. |
| `429` throttling messages in logs | Harmless — the server retries automatically. Lower `AMAZON_ADS_RATE_LIMIT_RPS` if persistent. |

Still stuck? [Open an issue](https://github.com/Imsamiullah09/amazon-ads-mcp/issues) — include the error message (it contains Amazon's request id) but **never your credentials**.

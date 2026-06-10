# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the Security tab) on this repository. You'll get an acknowledgment within a week.

## Threat model & hardening notes

- **Credentials**: LwA client id/secret and the refresh token are read from environment variables only, never persisted, and redacted from logs. The refresh token grants ongoing read access to your advertising data — treat it like a password and rotate it via Amazon if exposed.
- **Logs** go to stderr and never include tokens, secrets, or `Authorization` headers (pino redaction).
- **stdio transport** (default) exposes nothing on the network.
- **HTTP transport** intentionally has **no built-in auth** because the process embodies a single advertiser's credentials; the compose file binds to `127.0.0.1`. Never expose the port publicly without an authenticating reverse proxy.
- **File writes** are restricted to `REPORT_OUTPUT_DIR`; `saveAs` accepts basenames only (path traversal rejected).
- **Read-only**: no tool can mutate campaigns, budgets, or bids in v1.

## Supported versions

Only the latest release receives security fixes.

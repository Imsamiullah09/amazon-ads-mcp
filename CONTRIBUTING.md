# Contributing

Thanks for considering a contribution!

## Setup

```bash
git clone https://github.com/OWNER/amazon-ads-mcp.git
cd amazon-ads-mcp
npm ci
npm test
```

Tests never hit the network — `fetch` is mocked at the boundary — so no Amazon credentials are needed to develop.

## Workflow

1. Fork, branch from `main`.
2. Make your change. Match the existing layering (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):
   - endpoint knowledge → `src/api/`
   - cross-cutting HTTP behavior → `src/http/client.ts`
   - tool schemas/descriptions → `src/tools/register.ts`
3. Add or update tests. `npm run typecheck && npm test` must pass.
4. Open a PR describing **what Amazon API surface you verified against** (link the docs page). Distinguish verified behavior from assumptions — this project's credibility depends on it.

## Ground rules

- **No mock/fabricated data paths** in production code.
- **Read-only stays the default.** Write operations (campaign mutations) need an explicit opt-in flag and confirmation-oriented tool descriptions; open an issue to discuss design first.
- Never log or commit credentials. The pino redaction list in `src/logging.ts` must cover any new secret-bearing fields.
- New tools need: a tight description (Claude reads it!), zod schemas with `.describe()` on every param, the `guard()` wrapper, and wire-protocol test coverage in `tests/server.test.ts`.

## Releases

Maintainers: bump `version` in `package.json` and `SERVER_VERSION` in `src/server.ts` together.

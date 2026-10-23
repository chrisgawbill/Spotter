# QA-22–QA-26 same-origin API fixtures — STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- Plan `docs/plans/api-fixtures.md`, contracts `docs/plans/api-fixtures-contracts.md` (C1–C6), frozen.
- Coordinator wrote `examples/same-origin-api/` (static app calling `/api/items` and `/api/summary`,
  `server.mjs` needing `x-api-token`, `vite.config.js` proxy, `project.yml`). Do not edit it.

## Baseline (branch same-origin-api-fixtures @ 3b882a8, before any coder change)
- `npm test` on host Node 18.19.1: **86 tests, 86 pass, 0 fail**.
- Docker browser integration: all pass (authentication needs `examples/` mounted).
- No typecheck or lint in this repo (plain ESM JavaScript, Node test runner).

## Frozen decisions
- One interception path: `context.route(apiRequestMatcher(...))` serves both the fake origin and app-origin
  paths under `web.api.paths`. Fixture keys unchanged (`METHOD /path?sorted=query`).
- Normalized `web.api` = `{ fakeOrigin, envVar|null, recordFrom|null, headers {}, paths [], backend null|{run,readyUrl,timeoutMs} }`.
- Recording headers are record-only; only `${NAME}`-resolved values are secrets.
- Web summary gains `apiNotReplayed: string[]` (sorted unique `METHOD /pathname`, always present).
- Completeness gap text is fixed in C4; report.mjs is unchanged.
- Backend: own process group, TERM then KILL after 5 s, stopped on every exit path; record only.

## Repo patterns
- ESM `.mjs`, two-space indent, single quotes, terse `/** … */` JSDoc above exports, dense one-line logic.
- Tests: `node:test` + `node:assert/strict`, one `test('plain sentence', …)` per behaviour.
- **Host Node is 18**: a unit test must never import a module that imports `playwright`
  (`src/cli.mjs`, `src/stages/*.mjs`). Browser tests live in `integration/` and run in Docker.
- Nothing project-specific in `src/`. Do not mention AI tools in code, comments or messages.
- `createFinding` keys must stay stable: no ports, line numbers, query values or counts.

## In flight (wave 1, parallel; each agent owns its files exclusively)
- replay: config.mjs, config-fields.mjs, fixtures.mjs, stages/web.mjs, stages/specsFixture.mjs, test/config.test.mjs, test/fixtures.test.mjs, integration/same-origin-api.test.mjs
- setup: route-discovery.mjs, project-options.mjs, test/route-discovery.test.mjs, test/project-setup.test.mjs
- backend: backend.mjs, cli.mjs, test/backend.test.mjs
- coverage: completeness.mjs, test/completeness.test.mjs, test/report.test.mjs
- Coordinator: README, docs, examples, plans, verification.

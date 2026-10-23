# QA-12 browser matrix — STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- Coordinator: `src/browsers.mjs` (contract C1) + `test/browsers.test.mjs` (4 tests pass). Read-only for agents.

## Baseline
- main @ cf0e6c8: `npm test` 145/145 pass (149 with test/browsers.test.mjs).
- No typecheck or lint (plain ESM JavaScript, Node test runner).
- Host Node is 18.19.1: `playwright` CANNOT be imported on the host. Unit tests (`npm test`) run on the host,
  so `src/browsers.mjs`, `src/config.mjs`, `src/levels.mjs`, `src/completeness.mjs`, `src/config-drift.mjs`,
  `src/stages/specs.mjs` must never import `playwright`. Only `src/stages/web.mjs` and `src/visual.mjs` may.
- Image `spotter:latest` (Node 24) has /ms-playwright with chromium, firefox and webkit.
- Browser integration runs in Docker:
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/<file>.test.mjs`

## Frozen decisions
- Contracts: `docs/plans/browser-matrix-contracts.md` (C1–C8). Do not redesign.
- Chromium target is keyless (no `browser` key, no `where`/screenshot suffix) so legacy configs are unchanged.
- Primary case = first browser: only it runs fault visits, axe, keyboard and recording.
- high = configured matrix ∪ `levels.high`; low = first browser, no devices; medium = configured.
- Live-auth specs stay single-browser.

## Repo patterns
- ESM `.mjs`, two-space indent, single quotes, terse `/** … */` one-liners above exports.
- Tests: `node:test` + `node:assert/strict`, one `test('plain sentence', …)` per behaviour.
- Nothing project-specific in `src/`. Do not mention AI tools in code or comments.

## In flight (wave 1, parallel)
- engine: config, levels, completeness, config-fields and their unit tests.
- sweep: web stage, specs stage, scheme check, new integration test.
- Coordinator owns README/docs/examples/Dockerfile.

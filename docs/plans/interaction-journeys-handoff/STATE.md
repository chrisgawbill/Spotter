# QA-10 STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- QA-12 browser matrix (DONE). `src/` needs no change for QA-10.

## Baseline (2026-10-23, before QA-10)
- `npm test` on host: 157/157 pass.
- Image `spotter:latest` (Chromium, Firefox, WebKit, Node 20+). Host Node is 18 and has no
  browsers: run Playwright-based integration tests in Docker only.
- Integration command (mount examples too, the test copies from it):
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" -v "$PWD/examples:/opt/spotter/examples:ro" --entrypoint node spotter:latest --test integration/journeys.test.mjs`

## Frozen decisions
- No journey language; plain Playwright specs via `SPOTTER_TEST_MODULE`.
- Writes, persistence and response sequences live in the spec (`page.route`), per test.
- Custom `role="dialog"` with explicit focus management, not native `<dialog>`.
- `@critical` in test names selects the low-level journey set (`levels.low.specs.grep`).
- Failure identity = test title (+ project); titles in the contracts are exact.

## Repo rules
- Nothing project-specific in `src/`. Do not mention AI tools in code or comments.
- Example code is illustrative: smallest readable app, no CSS framework, no dependencies.

## In flight
- Wave 1: `journeys` agent owns `examples/journeys/index.html`, `examples/journeys/journeys.spec.mjs`, `integration/journeys.test.mjs`.
- Coordinator owns docs, README, ticket files and `docs/plans/interaction-journeys*`.

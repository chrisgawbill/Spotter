# QA-11 STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- Wave 1 (coordinator re-verified): `examples/recovery/index.html`, `examples/recovery/scores.journey.mjs`, `integration/recovery.test.mjs` (now passes `fixtures: { recordedAt, entries: {} }` so Date is frozen). Docker: recovery 4/4, journeys 4/4, specs 3/3.
- Coordinator edits: `src/levels.mjs` dropped the QA-11 `UNSUPPORTED_AT_HIGH` entry; `test/levels.test.mjs:38` asserts tickets `['QA-13', 'QA-15']`. README and docs updated for fault kinds.
- QA-10 interaction journeys (DONE): `examples/journeys`, `integration/journeys.test.mjs`. Reuse their pattern.

## Baseline (2026-10-24, before QA-11)
- `npm test` on host: 160/160 pass (after the levels edit).
- Image `spotter:latest` (Chromium, Firefox, WebKit, Node 20+). Host Node is 18 and has no
  browsers: run Playwright-based integration tests in Docker only.
- Integration command (mount examples too, the test copies from it):
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" -v "$PWD/examples:/opt/spotter/examples:ro" --entrypoint node spotter:latest --test integration/<name>.test.mjs`

## Frozen decisions
- No shared fault machinery; scenarios are plain Playwright specs via `SPOTTER_TEST_MODULE` using `page.route` and `context.setOffline`.
- The spec adapter freezes `Date` only (`clock.setFixedTime`); timers run, so real `Retry-After` waits work.
- Injected failures must produce zero findings; uncaught page errors fail the test (afterEach on collected `pageerror`).
- Sweep fault kinds: `FAULT_KINDS` / `DEFAULT_FAULT_KINDS` live in `src/levels.mjs` (pure; no Playwright). No default `kinds` is normalized into config (keeps cache keys stable).
- `@critical` in test names selects the low-level set (`levels.low.specs.grep`).
- Failure identity = test title (+ project); titles in the contracts are exact.

## Repo rules
- Nothing project-specific in `src/`. Do not mention AI tools in code or comments.
- Example code is illustrative: smallest readable app, no CSS, no dependencies.

## In flight
- Wave 2: `sweep-faults` agent owns `src/levels.mjs`, `test/levels.test.mjs`, `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs`, `src/fixtures.mjs`, `src/stages/web.mjs`, `integration/browser-depth.test.mjs`. Runs alone.
- Coordinator owns docs, README, ticket files and `docs/plans/fault-recovery*`.

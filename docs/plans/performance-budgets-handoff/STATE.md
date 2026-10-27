# QA-15 STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- Plan: `docs/plans/performance-budgets.md`; contracts: `docs/plans/performance-budgets-contracts.md` (frozen).
- Wave 1 `core` (coordinator re-verified): `src/performance.mjs`, `test/performance.test.mjs`. Exports exactly C3. `absoluteBudgetFindings(cfg, measurements, { project })`, `relativeBudgetFindings(cfg, head, base, { baseCached, project })` take the NORMALIZED `web.performance`. `summarizePerformance(run)` needs `run.performance.budgets` normalized.
- Wave 2 `collect` (coordinator re-verified diff, npm test 186/186; agent ran Docker browser-depth 5/5, specs 3/3, journeys 4/4, recovery 4/4, browser-matrix 4/4): config validation/normalization (`web.performance`), levels (low drops, non-high strips timings), `spotterTiming` fixture, `runTimedSpecs`, web-stage collection + `sampleTimings`/`samplePageLoad`, absolute findings in `runWebStage`, `runSide({ timingGate })` calling `done()` in finally.
- Page-load samples do NOT freeze the clock (Chromium gives no navigation entries under setFixedTime); an unrecorded request during sampling sets `timingError` and drops that route's metric. Interaction specs keep the freeze.
- If sampling fails part-way, collected timings are kept alongside `timingError`; `timings`/`environment` are null when nothing was produced.

## Baseline (2026-10-27, before QA-15)
- `npm test` on host (Node 24): 188/188 pass after wave 4 (166 before QA-15).
- Image `spotter:latest`: Node 24.21, Playwright 1.64.1, Chromium/Firefox/WebKit. Run Playwright-based
  integration tests in Docker only:
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" -v "$PWD/examples:/opt/spotter/examples:ro" --entrypoint node spotter:latest --test integration/<name>.test.mjs`

## Frozen decisions (Product Owner 2026-10-27 + coordinator)
- Nothing is measured unless `web.performance` is configured; findings come only from budgets.
- Timings only at level high and only when `web.performance.timings` is configured (levels.mjs strips `timings` otherwise, so the web stage just checks `web.performance?.timings`).
- Cached base timings are never compared ("not comparable"); resources compare with cached bases.
- Advisory `low` by default; `blocking: true` → `medium`.
- Absolute (`max`) budgets: per-side findings through the normal baseline split. Relative (`maxIncrease`): computed in cli after both sides, appended to newFindings.
- Noise rule for relative timings: head median over allowed AND head min > base max (`timingIncreased`).
- Route metrics come from the healthy primary visit only (first target, first viewport, first scheme, anonymous).
- Finding keys `{ metric, budget }`; never put measured values in keys.

## Repo rules
- Nothing project-specific in `src/`. Do not mention AI tools in code, comments or commits.
- Match surrounding style: ES modules, dense one-line JSDoc comments, `node:test` + `node:assert/strict`.
- Do not commit; the coordinator commits.
- Wave 3 `example`: `examples/performance/` (index.html, app.js with a 1 kB filler so seeds stay under 10% build growth, details.journey.mjs) and `integration/performance.test.mjs` (6/6 twice in Docker, ~62 s). Seeds each produce exactly their metric; gate verified with two sides.

## In flight
- Nothing. Wave 4 `surface` landed (coordinator: shared `formatValue` reuse, no-wrap performance table). Verification recorded in docs/ticket-evidence.md#qa-15. Awaiting Product Owner sample acceptance.

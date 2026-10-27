# surface (QA-15 wave 4) report

## Result
`npm test`: 188/188 pass (baseline 186, +2 new tests). `node --check src/cli.mjs` ok. No Docker, no real `spotter run`.

## Changes
- `src/cli.mjs`: imports `createTimingGate`, `relativeBudgetFindings`. `runProject` computes `baseRuns`, creates the gate (parties 2 only when the base is going to run and `plan.config.web.performance.timings` is set, else 1), passes `timingGate: gate.side()` to the head `runSide` and to `loadOrRunBase`. After `comparison` (before the sort loop), when `plan.config.web.performance`: builds `run.performance = { budgets, head, base, notCompared }` (base null for baseline `failed`/`none`; `baseCached` from status `cached`; `project: config.name`) and appends relative findings to `comparison.newFindings`. `run.performance` is only present when `web.performance` is configured. `loadOrRunBase` is now a thin wrapper that calls `timingGate.done()` in a `finally` around the renamed `loadOrRunBaseSide` (which passes `timingGate` to the fresh base `runSide`).
- `src/report.mjs`: `renderStageSummary` adds `- <summarizePerformance(run)>` (one line) when `run.performance`.
- `src/htmlReport.mjs`: `Performance` section after Coverage (Metric | Base | Head | Change | Budget, resources then timings as median with min-max, environment line, timing error, replay sentence only when `head.timings`). Empty string when no `run.performance`.
- `src/completeness.mjs`: `requirableNames` adds `performance`; `listItems` adds the `performance` item (executed / missing if required / skipped otherwise; follows the web item's status when web is down); `assessCompleteness` adds note `performance: <reason>` for the non-required skipped case.
- Tests: `test/report.test.mjs` (+1), `test/completeness.test.mjs` (+1).

## Deviations to note
- Gate timing: the brief/contract says decide cached before starting sides. I did not split out the cache key; parties is 2 whenever a base side is launched with timings, and `loadOrRunBase` calls `done()` in a `finally`, so on a cache hit (or throw) the head is released as soon as the lookup returns. Behaviour is equivalent (head waits only for the cache lookup) and the diff avoids touching the cache key code.
- `formatValue` is not exported from `src/performance.mjs`, so `htmlReport.mjs` has a small local value formatter (same rules: ms for timings, bytes for build/`bytes`/`imageBytes`, else the number).
- The Budget column uses `budgetMetrics` from `performance.mjs` to match wildcard budgets.
- The completeness note is skipped when web was skipped/live-auth (item then mirrors web's status, no performance note).

## Owed
A real `spotter run` (head vs base with timings at level high, and a cached-base rerun) to confirm the gate release and the HTML section; not run by me.

## ESCALATIONS
None.

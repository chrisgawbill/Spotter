# Brief: collect (QA-15 wave 2)

This brief is your primary context and is meant to be complete. But it is a summary
written by someone else, and it can be stale or wrong. If the actual code contradicts
it, **the code wins** — follow the code, and report the discrepancy to the coordinator.
Read beyond this brief when you genuinely need to; just don't re-read the full plan to
rediscover what is already written here.

**When you need context or judgement this brief does not give you, ask the coordinator
rather than working it out yourself.** Send it with
`SendMessage({to: "main", message: "..."})` — you are a background subagent, so `"main"`
reaches the coordinator that briefed you. Say what you were doing, the
specific question, and what you would do absent an answer. Then **stop and wait**; the
coordinator replies by messaging you back, which resumes you with your context intact.
If `SendMessage` is unavailable to you, stop and put the question at the top of your
report instead.

Which way to go:
- **Local and checkable** — what a function returns, which shape a row has, whether a
  guard exists: read the code. That is not a question, that is your job.
- **Design, scope, contract, or priority** — the brief is silent or ambiguous, two
  readings lead to different implementations, the contract seems wrong, the change wants
  a file you do not own: **ask.** Do not decide it yourself. Thinking is the
  coordinator's job and it has the whole picture; you have one slice of it.
- **Already resolved provisionally** — you made a call to keep moving: it still goes in
  `## ESCALATIONS`, even if the tests pass.

A question costs one round trip; a confident wrong guess costs a debugging cycle.

## Your files (only these)

## Your files (only these)
- `src/stages/web.mjs`, `src/stages/specs.mjs`, `src/stages/specsFixture.mjs`
- `src/runner.mjs`
- `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs`
- `src/levels.mjs`, `test/levels.test.mjs`
- Your report `docs/plans/performance-budgets-progress/collect.md`

Read-only, already landed (wave 1, do not edit): `src/performance.mjs` (exports per contract C3:
`performanceProblems`, `normalizePerformance`, `measureBuild`, `routeMetrics`, `aggregate`,
`createTimingGate`, ...). Not yours: `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`,
`src/completeness.mjs` (wave 4 `surface`), `examples/`, `integration/` (wave 3 `example`).

## Contract
Read `docs/plans/performance-budgets-contracts.md` C1, C2, C4, C5 (and skim C3 for the
`performance.mjs` signatures). Implement C2, C4 and C5 exactly.

## Tasks
1. **Config** (`src/config.mjs`): push `...performanceProblems(config.web)` into `problems` when
   `config.web` is set (near the faultInjection checks, ~line 83-103). In `normalizeWebConfig`
   (~line 140) set `performance: normalizePerformance(web.performance)` (null when absent), so
   the raw object never leaks through the `...web` spread.
2. **Config fields** (`src/config-fields.mjs`): add a `'web.performance'` entry after
   `'web.faultInjection'` (label `Performance budgets`, type `object`, an `example` adapted from
   the C1 YAML indented under `web` like its neighbours, and a `help` sentence: opt-in; nothing is
   measured without it; budgets are advisory unless `blocking: true`; `maxIncrease` compares with
   the merge base; timings run only at level high).
3. **Levels** (`src/levels.mjs`): C5 — drop the QA-15 entry from `UNSUPPORTED_AT_HIGH`; low sets
   `web.performance = null` with the exclusion; non-high strips `timings` with the medium exclusion
   (the existing `exclude` helper only knows the low reason; add the reason without changing low's
   output); `summarizePlan` additions. Update `test/levels.test.mjs:38` (now `['QA-13']`) and
   `:109`, and add tests for the low exclusion, medium timings exclusion, no-level stripping
   without an exclusion, high keeping timings, and the plan line.
4. **Spec fixture** (`src/stages/specsFixture.mjs`): add `spotterTiming` exactly as C4.
5. **Timed specs** (`src/stages/specs.mjs`): export `runTimedSpecs` per C4. Reuse the existing
   Playwright config writer/runner; refactor inside the file as needed (e.g. an internal helper
   taking `{ repeatEach, workers, grep, projects, dirName }`), keeping `runSpecsStage` behaviour
   and output identical. The JSON reporter puts attachments at
   `suites[].specs[].tests[].results[].attachments[]` with `name`, `contentType`, and `body`
   (base64) — verify against a real report in Docker rather than trusting this sentence.
6. **Web stage** (`src/stages/web.mjs`), sweep mode only, when `web.performance`:
   - build metrics via `measureBuild(path.join(workdir, web.build.outDir))` right after a
     successful build;
   - route metrics from the primary healthy visit per C2: count requests / API requests / bytes /
     image bytes inside `visitPage` only when the job is the primary measuring visit (first target,
     first viewport, first colour scheme, `anonymous`, not a fault) and return them on the result;
     `bytes` via `await response.body()` length guarded with `.catch(() => null)` (redirects and
     aborted bodies throw); app-origin non-API only; use the existing `apiRequestMatcher`;
   - timings last (after specs), per C5 with the optional `timingGate` parameter; page-load
     sampling as C2 (a small `samplePageLoad` helper reusing `replayFixtures`, `sessionStorageState`,
     the clock freeze and `deviceOptions`, not `visitPage`); interaction samples via
     `runTimedSpecs` with the first target's project (null on the default matrix);
     `aggregate` each metric; environment per C2; failures → `timingError` (first line), never throw;
   - `summary.performance` = `{ resources, timings, environment, timingError }` per C2.
   - append `absoluteBudgetFindings(web.performance, summary.performance, { project: config.name })`
     to the stage's returned findings (absolute budgets flow through the normal baseline split).
   Keep everything else in `runWebStage`/`visitPage` byte-for-byte equivalent in behaviour.
   Do not slow down runs without `web.performance` (no extra body reads, no extra visits).
7. **Runner** (`src/runner.mjs`): `runSide` accepts `timingGate`, passes it to `runWebStage`, and
   calls `timingGate?.done()` in its `finally`.

## What to keep
- Fault visits, session checks, `apiNotReplayed`, screenshots, accessibility/keyboard: unchanged.
- `runSpecsStage` return shape and logs dir (`logs/specs/`) unchanged; timed run logs to
  `logs/specs-timing/`.
- Cache-key stability: configs without `web.performance` must normalize exactly as before
  (`performance: null` is a new key in normalized web config; confirm `configHash` is computed
  from the YAML source, not the normalized object — `src/config.mjs:136` — so this is safe;
  `plan.hash` hashes the effective config, so it WILL change once for every project. That is
  accepted (Spotter version is in the cache key anyway).

## Required tests
- `test/config.test.mjs`: a valid `web.performance` normalizes; an invalid one throws with the
  `performanceProblems` message; absent → `web.performance === null`.
- `test/levels.test.mjs`: as task 3.
- Docker (no unit tests possible for Playwright code): a throwaway check that `runTimedSpecs`
  reads attachments and `runWebStage` returns `summary.performance` — use the C1-like config
  against `examples/journeys` or a temp dir; do NOT add files under `integration/` or `examples/`
  (wave 3 owns them). Record what you ran and saw in your report.

## Verify
- `npm test` (you run alone; baseline 166 + core's new tests — see STATE.md).
- Existing Docker integration tests that exercise your files must still pass:
  `browser-depth`, `specs`, `journeys`, `recovery`, `browser-matrix` (command in STATE.md).

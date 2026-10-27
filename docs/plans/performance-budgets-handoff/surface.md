# Brief: surface (QA-15 wave 4)

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
- `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`, `src/completeness.mjs`
- `test/report.test.mjs`, `test/completeness.test.mjs` (and a new `test/cli-performance.test.mjs`
  only if a pure helper you export from `cli.mjs` needs a test)
- Your report `docs/plans/performance-budgets-progress/surface.md`

Read-only, already landed: `src/performance.mjs` (C3: `absoluteBudgetFindings`,
`relativeBudgetFindings`, `summarizePerformance`, `createTimingGate`, ...); waves 2–3
(`src/stages/*`, `src/runner.mjs` with `runSide({ ..., timingGate })`, `src/config.mjs`,
`src/levels.mjs`, `examples/performance`, `integration/performance.test.mjs`).

## Contract
`docs/plans/performance-budgets-contracts.md` C5 (gate wiring) and C6. Implement C6 exactly.

## Tasks
1. `src/cli.mjs` `runProject` (~line 130-220) and `loadOrRunBase` (~223-245):
   - Decide whether the base runs fresh before starting the sides: `loadOrRunBase` computes the
     cache key; split out the key/lookup so `runProject` knows `cached` up front, or pass the
     gate side into `loadOrRunBase` and call `side.done()` there on a cache hit and on throw.
     Pick whichever is the smaller diff; parties = 2 only when timings are in the plan
     (`plan.config.web?.performance?.timings`) and the base runs fresh; else 1.
   - Pass `timingGate` to the head `runSide` and to the fresh base `runSide`.
   - After `comparison`: build `run.performance` per C6; append
     `relativeBudgetFindings(...).findings` to `comparison.newFindings` before the existing sort
     loop (so they get sorted and host-pathed); `base` is null when `baseline.status` is
     `failed` or `none`; `baseCached = baseline.status === 'cached'`. Use `config.name` as
     `project`. Absolute findings: none here (`runWebStage` emits them).
2. `src/report.mjs` `renderStageSummary`: add `- performance: …` via `summarizePerformance(run)`
   when `run.performance`.
3. `src/htmlReport.mjs`: the Performance section per C6, matching existing table/badge markup and
   `escape`; place it after `${coverage(run.completeness)}`.
4. `src/completeness.mjs`: `requirableNames` adds `performance` when `web.performance` is set; the
   `performance` item and note per C6 in `listItems`/`assessCompleteness`.

## Already handled by wave 2
Absolute (`max`) findings are emitted by `runWebStage` (C5); do not add them again in `cli.mjs`.

## What to keep
Exit codes, `resultOf`, existing report lines, `report.md` brevity (exactly one new line),
baseline cache key format, completeness for configs without `web.performance` (identical output).

## Required tests
- `test/report.test.mjs`: the performance line appears only with `run.performance`; HTML section
  renders rows and the replay sentence only with timings; markdown otherwise unchanged.
- `test/completeness.test.mjs`: requirable `performance`; executed / required-missing (gap) /
  not-required-skipped (note, no gap) / excluded at low.

## Verify
`npm test` (you run alone). Then a real run, only if the coordinator has not already done it:
leave that to the coordinator — just say in your report that it is owed.

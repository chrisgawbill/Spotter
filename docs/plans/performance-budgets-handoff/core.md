# Brief: core (QA-15 wave 1)

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
- `src/performance.mjs` (new)
- `test/performance.test.mjs` (new)

## Contract
Implement **C1 validation/normalization** (`performanceProblems`, `normalizePerformance`) and
**all of C3** from `docs/plans/performance-budgets-contracts.md` exactly. Read sections C1, C2
and C3 of that file; C2 defines the measurement shapes your functions consume. C4–C6 are
other agents' work, but `summarizePerformance(run)` reads the C6 `run.performance` shape.

Notes:
- `performanceProblems(rawWeb)` receives the raw `web` object (routes may be strings or
  `{ name, path }`; see `levelProblems` in `src/levels.mjs` for the same pattern) and returns
  messages in the style of `src/config.mjs` (backticked field names). It does not need the
  rest of the config: `web.specs` presence is on `rawWeb.specs`.
- `normalizePerformance(undefined)` → `null`; defaults: `blocking: false`, `samples: 5`,
  `routes: []`, `interactions: null`, `timings: null` when absent.
- Use `createFinding` from `src/findings.mjs` (stage `web`, check `performance-budget`).
- `createTimingGate`: plain promises, no timers. FIFO lock = promise chain.
- Keep it one module, the smallest code that meets the contract. No new dependencies.

## Existing code to match
- `src/levels.mjs` (validation style, `isObject`/`onlyKeys` helpers — copy the two-liners, do
  not import private helpers), `src/findings.mjs`.

## Required tests (`test/performance.test.mjs`)
1. Validation: accepts the C1 example (with matching routes/specs); rejects unknown keys, a
   budget without max/maxIncrease, bad percent strings, unknown metric names, `route.x.*` for an
   unconfigured route, `timing.*` without timings routes, `interaction.*` without interactions,
   interactions without `web.specs`, samples outside 3..20.
2. Normalization of `maxIncrease` `'10%'` → `{ percent: 10 }`, `200` → `{ amount: 200 }`.
3. `measureBuild` on a temp dir: categories, gzip for text, raw for binary, `.map` excluded,
   all six keys present on an empty dir.
4. `aggregate`: odd and even counts.
5. `budgetMetrics` expands `route.*.requests` and `timing.*.load`.
6. Absolute findings: over/under/equal max; severity low vs medium; titles and keys per C3;
   timing compares median; a finding id is identical for different measured values.
7. Relative: resources percent and amount, base 0; timing noise rule (median over but
   overlapping samples → no finding; both conditions → finding); cached base → notCompared
   `cached base`; environment mismatch → `different environment`; metric missing on base →
   `not measured on base`; base null → `no baseline`.
8. `summarizePerformance` for compared / no-baseline / cached-base cases.
9. `createTimingGate`: arrive waits for both parties; `done()` of one side releases the other;
   turns never overlap.

## Verify
- `node --test test/performance.test.mjs` and then `npm test` (you run alone, so the full
  suite is fine). Baseline: 166/166 before your file.

## Report
Write `docs/plans/performance-budgets-progress/core.md`: what you implemented, exported names,
test counts, anything a caller must know, and `## ESCALATIONS`.

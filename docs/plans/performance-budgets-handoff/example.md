# Brief: example (QA-15 wave 3)

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
- `examples/performance/` (new: `index.html`, `app.js`, `details.journey.mjs`, and anything else
  the tiny app needs)
- `integration/performance.test.mjs` (new)
- Your report `docs/plans/performance-budgets-progress/example.md`

Read-only, already landed: `src/performance.mjs` (C3), `src/stages/web.mjs` /
`src/stages/specs.mjs` / `src/stages/specsFixture.mjs` / `src/runner.mjs` / `src/config.mjs` /
`src/levels.mjs` (wave 2). If any of them is wrong, message the coordinator; do not edit them.

## Contract
`docs/plans/performance-budgets-contracts.md` C1–C5. You consume them; you implement none.

## The example app (illustrative, smallest readable; no CSS, no dependencies)
Match `examples/journeys/` and `examples/recovery/` style. One page:
- `index.html` loads `app.js` as a module. Heading `Items`, a list filled from
  `GET api/items` (relative URL; same-origin API under `/api`), and a button `Open details`
  that reveals a `role="region"` named `Details` (or a dialog) synchronously.
- `app.js` holds the logic and contains these exact strings once each, as seed anchors:
  `/* bundle seed */`, `load();` (the single initial call), and the click handler body
  statement that reveals the details.
- `details.journey.mjs`: imports `{ test, expect }` from `process.env.SPOTTER_TEST_MODULE`;
  test named exactly `Performance Verify: opening details is quick @perf`, which wraps
  click → `expect(details).toBeVisible()` in `spotterTiming('open details', ...)`.

## Integration test (`integration/performance.test.mjs`)
Copy `examples/performance` to a temp dir (like `integration/recovery.test.mjs`), use a build
command that copies the files into `dist/` (e.g. `mkdir -p dist && cp index.html app.js dist/`),
and build the config with `normalizeConfig` from `src/config.mjs` so defaults apply. Replay one
fixture for `GET /api/items` (read `src/fixtures.mjs` for the entry key/shape and
`integration/same-origin-api.test.mjs` for a same-origin example). Config:

```yaml
web:
  build: { run: <copy command>, outDir: dist }
  api: { paths: [/api] }
  routes: [{ name: home, path: / }]
  viewports: [1280]
  accessibility: false
  keyboard: false
  faultInjection: false
  specs: { files: [details.journey.mjs] }
  performance:
    budgets:
      - { metric: build.js, maxIncrease: '10%' }
      - { metric: 'route.*.requests', maxIncrease: 0, blocking: true }
      - { metric: 'route.*.apiRequests', max: 1 }
      - { metric: interaction.open details, maxIncrease: '100%' }
      - { metric: timing.home.load, maxIncrease: '100%' }
    timings: { samples: 5, routes: [home], interactions: { grep: '@perf' } }
```

Call `runWebStage` directly (sweep mode) for each side. Absolute (`max`) findings are already in
the stage's returned `findings` (check `performance-budget`); split them with `compareWithBaseline`.
Relative findings come from `relativeBudgetFindings(config.web.performance, headPerf, basePerf, { baseCached: false, project })`.

Subtests:
1. **Healthy repeat is reproducible**: two healthy runs → identical `resources`; no relative
   finding of either side vs the other (timings included); no absolute finding; `timings` has
   `timing.home.load` and `interaction.open details` with 5 samples each; `environment.api`
   is `replayed`; `timingError` null.
2. **Seeds** (exact-string replacement, assert each anchor occurs exactly once):
   - bundle growth: `/* bundle seed */` → a string constant of ~200 kB of
     `crypto.randomBytes(...).toString('base64')` (incompressible) that `app.js` references so it
     is not dead → only `build.js` (and `build.total` has no budget) regresses;
   - request multiplication: `load();` → five calls → `route.home.requests` relative finding
     (severity `medium`) and the absolute `route.home.apiRequests` finding;
   - slow interaction: a ~400 ms busy loop before the reveal → `interaction.open details`
     finding (noise rule cleared); `timing.home.load` not flagged.
   Each seed's new findings are exactly the expected metrics (by `key`-derived title prefix),
   compared against the healthy run.
3. **Gate**: run two healthy sides concurrently with `createTimingGate(2)` (one `side()` each,
   passed as `timingGate`) → both complete, timing turns never overlap (wrap `turn` to record
   start/end), no deadlock; and a gate of 2 where one side calls `done()` without arriving
   still lets the other finish.
4. **Not configured**: the same config without `performance` → `summary.performance` undefined.

Mark anything you could not make deterministic explicitly in the report; do not loosen
thresholds silently — ask first.

## Verify (Docker; command in STATE.md, examples are mounted)
`node --test integration/performance.test.mjs`, then the neighbours touching shared code:
`journeys`, `recovery`, `specs`. Do not run `npm test`-only claims for browser behaviour.

# QA-15 performance regression budgets — plan

Started by the Product Owner 2026-10-27 ("Start QA-15").
Product Owner answered the open questions 2026-10-27 (below). Other coordinator decisions are
provisional until the Product Owner accepts a sample report.

## Findings against the code (2026-10-27)

| Ticket need | Already provided by | Where |
| --- | --- | --- |
| Built assets to measure | `web.build.outDir` exists after `buildApp`, served by the static server | `src/stages/web.mjs:40-45`, `src/staticServer.mjs` |
| Per-page requests and bytes | every healthy visit already listens to `request`/`response`; API keys are collected per visit | `trackNetwork`, `watchPageProblems`, `requests` set in `visitPage` (`src/stages/web.mjs`) |
| Replay identity | fixtures replayed with the clock frozen; `fixtures.hash` and `recordedAt` known | `src/fixtures.mjs`, `describeFixtures` in `src/completeness.mjs` |
| Base-side numbers | the base side's `stages` summary is cached and returned with its findings | `loadOrRunBase`, `readCachedSide` (`src/cli.mjs:223-245`) |
| Stable finding identity | `createFinding` key; numbers in titles are masked by `normalizeForFingerprint` | `src/findings.mjs` |
| Absolute budget vs base | ordinary findings on each side; a breach already on base is "existing" | `compareWithBaseline` |
| Spec-defined interaction boundaries | project specs via `SPOTTER_TEST_MODULE`; Playwright `repeatEach` gives repeated samples | `src/stages/specsFixture.mjs`, `src/stages/specs.mjs` |
| Level integration | `UNSUPPORTED_AT_HIGH` lists QA-15 | `src/levels.mjs:17`, `test/levels.test.mjs:38,109`, `README.md:123` |

Problems the design must handle:

- **Head and base run concurrently** (`Promise.all` in `runProject`), so timings taken during
  the sweeps measure contention, not the app.
- **The base side is usually cached**, so its timings come from another moment and load.
- Relative budgets need both sides' numbers; they cannot come out of the per-side baseline
  split and must be computed after both sides finish.

## Decisions (provisional)

| Question | Decision |
| --- | --- |
| What is measured | **Resources** (deterministic): build output bytes per type, and per route the request count, API request count, same-origin transferred bytes and image bytes. **Timings** (noisy): route load time and project-spec interaction timings. |
| Where resources come from | Build bytes: walk `outDir` after the build (gzip size for text types via `node:zlib`, raw size otherwise). Route numbers: the healthy primary visit only (first browser, first viewport, first colour scheme, anonymous session), so the matrix does not multiply them. |
| Measurement without budgets | None: nothing is measured unless `web.performance` is configured (PO, 2026-10-27). When configured, resources are collected at medium and high and shown in `report.json`/`report.html`; findings come **only** from budgets. |
| Config | `web.performance: { budgets: [...], timings: { samples, routes, interactions: { grep } } }`. A budget is `{ metric, max?, maxIncrease?, blocking? }`; `metric` is a stable name (`build.js`, `build.css`, `build.images`, `build.total`, `route.<name>.requests`, `route.<name>.apiRequests`, `route.<name>.bytes`, `route.<name>.imageBytes`, `timing.<route>.load`, `interaction.<name>`; `route.*.<field>` applies to every route). `maxIncrease` is a percentage string (`"10%"`) or an absolute number. |
| Severity | Advisory `low` by default; `blocking: true` makes it `medium` (fails the run). |
| Absolute budgets | Evaluated on each side; ordinary baseline split. Key `{ metric, budget: 'max' }`. |
| Relative budgets | Evaluated in `runProject` after both sides, on equivalent cases only; added to `newFindings` (they are a branch-vs-base statement by definition). Key `{ metric, budget: 'maxIncrease' }`. No base, or a failed baseline: listed as "not compared", never a finding. |
| Timing sampling | Only at level `high` and only when `web.performance.timings` is configured (keeps routine and default high runs fast). Runs after the sweep, one page at a time, `samples` (default 5) fresh contexts per route; boundary = navigation start to the `load` event (`PerformanceNavigationTiming`). Interactions: specs matching `interactions.grep` run with `repeatEach: samples`; a spec wraps its boundary in `spotterTiming(name, fn)` (new fixture), which records the duration as an annotation. |
| Aggregation and noise | Median of samples, with min/max kept. A relative timing breach needs the head median over `base median × (1 + pct)` **and** the head's fastest sample slower than the base's slowest. Absolute timing budgets compare the median. |
| Equivalent environments | Each measurement records browser name + version, CPU count, `api: replayed`, sample count and whether the base was cached. Timing samples on both sides take turns through one in-process FIFO lock after **both** sweeps finish (a barrier), so they never overlap the other side's sweep. Cached base timings, or a different environment record, are reported as "not comparable", never compared. Reports say timings measure the front end against replayed API responses, not backend performance. |
| Level integration | Drop QA-15 from `UNSUPPORTED_AT_HIGH`. Low skips performance (an `excluded` item). Medium: resources. High: resources plus configured timings. |
| Reports | `report.md`: only budget findings plus one `performance:` line in Checks (metric count, budgets, advisory/blocking, compared or not). `report.html`: head/base/delta table and environment. `report.json`: full measurements. |
| Completeness | Timings configured at high that fail to sample are an incomplete item only when `performance` is in `coverage.required`; otherwise a listed gap. |

## Product Owner answers (2026-10-27)

1. Resource numbers are collected **only when `web.performance` is configured**.
2. Timings run **only at high and only when `web.performance.timings` is configured**.
3. Cached base timings are **never compared**; they are reported as "not comparable".

## Verify plan

- Unit: metric naming, budget parsing and evaluation (absolute, percent, absolute delta),
  median/min/max, the noise rule, environment equivalence, config validation.
- Integration (Docker): `examples/performance/` tiny static app plus a journey spec using
  `spotterTiming`. Seeds by exact-string replacement: bundle growth (large inline module),
  request multiplication (the same fetch repeated), slow interaction (busy loop on click).
  Each produces one named budget finding; two healthy runs give identical resource numbers
  and no timing finding.
- Main and seeded-defect runs per AGENTS.md; healthy repeated `--level high` runs on
  HockeyStatsWebApp show no performance findings.

## Ownership and waves (for handoff)

| Wave | Agent | Files |
| --- | --- | --- |
| 1 | core | `src/performance.mjs` (new: build walk, metric names, budgets, aggregation, comparison, environment), `test/performance.test.mjs` (new) |
| 2 | collect | `src/stages/web.mjs`, `src/stages/specs.mjs`, `src/stages/specsFixture.mjs`, `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs`, `src/levels.mjs`, `test/levels.test.mjs` |
| 2 | example | `examples/performance/*`, `integration/performance.test.mjs` (new) |
| 3 | surface | `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`, `src/completeness.mjs`, their tests |
| — | coordinator | `README.md`, `docs/browser-checks.md`, `docs/project-specs.md`, `docs/ticket-index.md`, `docs/ticket-evidence.md`, `docs/plans/performance-budgets*`, verification |

Contracts (written after the open questions are answered): `performance-budgets-contracts.md`.

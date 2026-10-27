# QA-15 contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

## C1. Configuration — `web.performance`

Raw YAML (all optional except `budgets`):

```yaml
web:
  performance:
    budgets:
      - { metric: build.js, max: 250000 }                       # absolute, advisory
      - { metric: 'route.*.requests', maxIncrease: '20%', blocking: true }
      - { metric: timing.home.load, maxIncrease: 200 }          # absolute delta (ms)
      - { metric: interaction.open dialog, max: 300 }
    timings:
      samples: 5                 # integer 3..20, default 5
      routes: [home]             # configured route names (optional)
      interactions: { grep: '@perf' }   # project specs (optional; requires web.specs)
```

Normalized (`config.web.performance`; `null` when absent):

```js
{
  budgets: [{ metric: string, max: number | null, maxIncrease: { percent: number } | { amount: number } | null, blocking: boolean }],
  timings: { samples: number, routes: string[], interactions: { grep: string } | null } | null,
}
```

Validation (`performanceProblems(rawWeb)` returns string messages, `[]` when valid or absent):

- `performance` is an object with only `budgets` and `timings`; `budgets` a nonempty list.
- Each budget: only `metric`, `max`, `maxIncrease`, `blocking`; at least one of `max`/`maxIncrease`;
  `max` a nonnegative finite number; `maxIncrease` a nonnegative finite number or a string
  matching `/^\d+(\.\d+)?%$/`; `blocking` boolean when present.
- `metric` must match `isMetricPattern(metric, rawWeb)`:
  - `build.js` | `build.css` | `build.images` | `build.fonts` | `build.other` | `build.total`
  - `route.<route>.<field>` with `<route>` a configured route name or `*`, `<field>` one of
    `requests`, `apiRequests`, `bytes`, `imageBytes`
  - `timing.<route>.load` with `<route>` in `timings.routes` or `*`; requires `timings.routes`
    nonempty
  - `interaction.<name>` with nonempty `<name>`; requires `timings.interactions`
- `timings`: only `samples`, `routes`, `interactions`; `samples` integer 3..20; `routes` unique
  configured route names; `interactions` `{ grep: nonempty string }` and requires `web.specs`;
  at least one of nonempty `routes` or `interactions`.

`coverage.required` additionally accepts `performance` when `web.performance` is set
(`requirableNames` in `src/completeness.mjs`).

## C2. Measurements — `stages.web.performance`

Present on a side's web summary only when `config.web.performance` is set **and** the app
built; otherwise the key is absent.

```js
{
  resources: { [metric: string]: number },          // build.* and route.<name>.<field>
  timings: { [metric: string]: Timing } | null,     // null unless timings ran (level high)
  environment: { browser: string, cpus: number, api: 'replayed' | 'none', samples: number } | null, // null unless timings ran
  timingError: string | null,                       // first line of a sampling failure
}
Timing = { median: number, min: number, max: number, samples: number[] }   // milliseconds, rounded to 0.1
```

- **Build** (`measureBuild(outDir)`): walk every file under `outDir` except `*.map`. Size is the
  gzip length (`zlib.gzipSync(buf, { level: 9 })`) for text extensions
  `.js .mjs .css .html .svg .json .txt .webmanifest .xml`, raw length otherwise. Categories:
  `js` = `.js .mjs`; `css` = `.css`; `images` = `.png .jpg .jpeg .gif .webp .avif .svg .ico`;
  `fonts` = `.woff .woff2 .ttf .otf`; `other` = the rest. `build.total` = sum of all five.
  All six keys are always present (0 when empty).
- **Route** (one per configured route): taken from the healthy visit with the first target,
  first viewport, first colour scheme and the `anonymous` session — never fault visits.
  `requests` = `request` events from navigation until the visit settles; `apiRequests` = those
  matched by `apiRequestMatcher`; `bytes` = sum of response body lengths for app-origin, non-API
  responses; `imageBytes` = the subset whose `resourceType()` is `image`. A visit that failed to
  load contributes no route metrics.
- **Page-load timing** `timing.<route>.load`: after everything else in the side's web stage,
  for each `timings.routes` entry, `samples` fresh contexts, one at a time, each with the same
  replay, frozen clock, viewport, colour scheme and anonymous session as the healthy visit, in
  the first target's browser. Value = `performance.getEntriesByType('navigation')[0].loadEventEnd`
  read after it is > 0 (navigation start to end of the `load` event).
  Sampling does **not** freeze the clock (coordinator 2026-10-27: under `clock.setFixedTime` Chromium
  returns no navigation timing entries). Replay keeps `onUnrecorded`; any unrecorded request during
  a sample sets `timingError` (`page-load sampling requested unrecorded API data without the frozen
  clock (<key>)`) and that route's timing metric is omitted.
- **Interaction timing** `interaction.<name>`: specs matching `timings.interactions.grep` run once
  more with `repeatEach: samples`, `workers: 1`, first target only; each call of the
  `spotterTiming(name, fn)` fixture (C4) is one sample. A failing timed test adds no finding
  (the normal spec run reports it); its samples are still used.
- `environment.browser` = `` `${engine} ${browser.version()}` ``; `cpus` = `os.cpus().length`;
  `api` = `'replayed'` when `web.api`, else `'none'`; `samples` = configured samples.

## C3. `src/performance.mjs` (pure apart from `measureBuild`'s file reads; no Playwright)

```js
export const BUILD_METRICS = ['build.js', 'build.css', 'build.images', 'build.fonts', 'build.other', 'build.total'];
export const ROUTE_FIELDS = ['requests', 'apiRequests', 'bytes', 'imageBytes'];

export function performanceProblems(rawWeb): string[]
export function normalizePerformance(rawPerformance): NormalizedPerformance | null
export async function measureBuild(outDir): { [buildMetric]: number }
export function routeMetrics(routeName, { requests, apiRequests, bytes, imageBytes }): { [metric]: number }
export function aggregate(samples: number[]): Timing        // median of sorted samples (mean of the middle two when even)

/** Concrete metric names a budget applies to, among `names` (expands `route.*.x`, `timing.*.load`). */
export function budgetMetrics(budget, names: string[]): string[]

/** One side's absolute (`max`) budget findings. Timings compare their median. */
export function absoluteBudgetFindings(performanceConfig, measurements): Finding[]

/** True when a timing regression clears both the budget and the noise rule. */
export function timingIncreased(head: Timing, base: Timing, maxIncrease): boolean
//   head.median > allowedValue(base.median, maxIncrease) && head.min > base.max

/** True when timing environments are equivalent (browser, cpus, api, samples all equal). */
export function environmentsMatch(a, b): boolean

/**
 * Relative (`maxIncrease`) budget findings, head vs base.
 * base: measurements or null; baseCached: the base side came from the cache.
 * Resources compare whenever both sides measured the metric.
 * Timings compare only when !baseCached && both environments non-null && environmentsMatch.
 */
export function relativeBudgetFindings(performanceConfig, head, base, { baseCached }): {
  findings: Finding[],
  notCompared: [{ metric: string, reason: 'no baseline' | 'not measured on base' | 'cached base' | 'different environment' }],
}

/** One line for report.md `## Checks`. */
export function summarizePerformance(run): string

/** Timing turn-taking across the two sides of one run. */
export function createTimingGate(parties: number): { side(): GateSide }
//   GateSide = { arrive(): Promise<void>, turn(fn): Promise<T>, done(): void }
//   arrive() resolves once every party has arrived or called done().
//   turn(fn) runs fn under one FIFO lock shared by all sides (one sample per turn).
//   done() is idempotent; a side that never arrives must call it so the other is not blocked.
```

`allowedValue(base, maxIncrease)` = `base * (1 + percent / 100)` or `base + amount`.
A resource exceeds `maxIncrease` when `head > allowedValue(base, ...)`. With `percent` and
`base === 0`, any `head > 0` exceeds.

Findings (built with `createFinding`):

| Budget | stage / check | severity | title | key |
| --- | --- | --- | --- | --- |
| `max` | `web` / `performance-budget` | `blocking ? 'medium' : 'low'` | `performance budget exceeded: <metric> is <value> (max <max>)` | `{ metric, budget: 'max' }` |
| `maxIncrease` | `web` / `performance-budget` | same | `performance regression: <metric> rose from <base> to <head> (allowed <allowed>)` | `{ metric, budget: 'maxIncrease' }` |

- Values format by unit: `build.*`, `*.bytes`, `*.imageBytes` → bytes as `12.3 kB` (1000-based,
  one decimal; under 1000 → `512 B`); `*.requests`, `*.apiRequests` → plain integer;
  `timing.*`, `interaction.*` → `123.4 ms`. `<allowed>` is `+10%` or `+<formatted amount>`.
- `detail` for timing findings:
  `median of <n> samples (<min>–<max>); <browser>, <cpus> CPUs; API responses replayed — front-end timing, not backend performance`
  (`API not used` instead of the replay clause when `api: 'none'`).
- `detail` for resource findings: `null`.
- `repro`: `spotter run <project> --level high` for timing findings, else `null`. Callers pass
  the project name, so the exact signatures are
  `absoluteBudgetFindings(performanceConfig, measurements, { project })` and
  `relativeBudgetFindings(performanceConfig, head, base, { baseCached, project })`.

`summarizePerformance(run)` reads `run.performance` (C6) and returns, e.g.:
`performance: 14 metrics, 3 budgets (1 blocking) · timings 5 samples · compared with base`
with the last part `compared with base` | `not compared (no baseline)` |
`timings not compared (cached base)` | `timings not compared (different environment)`
(the first `notCompared` timing reason wins; resource-only gaps: `<n> metrics not on base`).
`timings` part only when `run.performance.head.timings`; `timings failed: <timingError>` when set.

## C4. Spec fixture — `spotterTiming`

Added to `test` in `src/stages/specsFixture.mjs`:

```js
spotterTiming: async ({}, use, testInfo) => use(async (name, fn) => {
  const started = performance.now();
  const result = await fn();
  await testInfo.attach('spotter-timing', { body: JSON.stringify({ name, ms: performance.now() - started }), contentType: 'application/json' });
  return result;
}),
```

Outside the timing run the attachment is ignored. `src/stages/specs.mjs` exports:

```js
/** Re-runs timed specs; returns samples per interaction metric. */
export async function runTimedSpecs({ config, workdir, logDir, fixtures, appOrigin, project, samples, grep }):
  { samples: { ['interaction.<name>']: number[] }, error: string | null }
```

`project` is the first target's Playwright project object (or null for the default matrix).
It reuses the existing config writer with `repeatEach: samples`, `workers: 1`, `grep`, and
reads `results[].attachments` named `spotter-timing` (base64 `body`) from the JSON report.
Logs go to `logs/specs-timing/`. No samples at all → `error: 'no spotterTiming samples'`.

## C5. Web stage and levels

- `runWebStage({ ..., timingGate })` — new optional `timingGate` (a `GateSide`). When absent,
  sampling runs without waiting (unit/integration callers). `runSide` passes it through.
- In sweep mode with `web.performance`: build metrics right after a successful build; route
  metrics from the visits (C2); then, last, if `web.performance.timings`:
  `await timingGate?.arrive()`, each page-load sample inside `timingGate.turn(...)` (or direct
  when absent), the interaction run as one turn; `timingGate?.done()` in a `finally`.
  Sampling errors set `timingError`; they never throw out of the web stage.
  `summary.performance` = C2, and the stage's findings gain
  `absoluteBudgetFindings(web.performance, summary.performance, { project: config.name })`.
- `runSide` calls `timingGate?.done()` in its `finally` so a side that skipped or failed web
  never blocks the other.
- `resolvePlan` (`src/levels.mjs`): drop the QA-15 entry from `UNSUPPORTED_AT_HIGH`.
  Low: `web.performance = null`, exclusion `{ name: 'performance', kind: 'performance', reason: 'excluded at level low' }`.
  Not high (medium or no level) with `timings`: `web.performance.timings = null`; at named level
  medium add exclusion `{ name: 'performance timings', kind: 'performance', reason: 'timings run at level high' }`.
  `summarizePlan` adds `performance (<n> budgets)` and, when timings remain, `+ timings ×<samples>`.

## C6. Run record, reports, completeness

`runProject` (`src/cli.mjs`):

- `createTimingGate(parties)` with `parties = 2` when the base will run fresh (not cached, not
  skipped) and the plan has timings, else `1`; head gets one `side()`, the fresh base the other.
  (Decide "will run fresh" by checking the cache file before starting both sides; `loadOrRunBase`
  calls `side.done()` when it returns from cache or throws.)
- After the comparison, when `plan.config.web?.performance`:
  ```js
  run.performance = { budgets, head: headPerf ?? null, base: basePerf ?? null, notCompared }
  ```
  where `headPerf = head.stages.web?.performance`, `basePerf = base?.side?.stages.web?.performance`
  (null when the baseline status is `failed` or `none`). Relative findings are appended to
  `comparison.newFindings` (then sorted as today). Absolute findings already flow through each
  side's findings.
- `report.md`: one `- performance: …` line from `summarizePerformance(run)` in `## Checks`.
  Nothing else changes.
- `report.html`: a `Performance` section after Coverage: a table `Metric | Base | Head | Change | Budget`
  (resources, then timings as median with min–max), the environment, and the sentence
  `Timings use replayed API responses and measure the front end, not backend performance.`
  (omit the sentence when no timings).
- `report.json`: `performance` as above.
- Completeness: when `web.performance` is set and the web stage executed, item
  `{ name: 'performance', kind: 'performance' }` is `executed` when `stages.web.performance`
  exists and `timingError` is null; else `missing` with the reason (`not measured` or
  `timings failed: <timingError>`) when `performance` is in `coverage.required` (a gap, so the
  run is incomplete); when not required the same case is `skipped` with that reason (no gap) and
  `notes` gains `performance: <reason>`.
  An `excluded` item from the plan replaces it as today.

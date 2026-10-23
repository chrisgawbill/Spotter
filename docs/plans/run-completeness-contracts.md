# QA-09 run completeness — frozen contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

## C1. Project configuration (owner: engine, `src/config.mjs`)

```yaml
coverage:                 # optional, top level
  required: [typecheck, web, specs]   # optional list of item names (see C4)
  minSpecs: 20            # optional positive integer; requires web.specs
web:
  sessions:
    - name: member
      localStorage: { token: x }
      expectSelector: '[data-account-menu]'   # optional nonempty string
```

Normalized config gains `coverage: { required: string[], minSpecs: number | null }`
(always present; defaults `[]` and `null`). Sessions keep `expectSelector` as given.

Validation problems (exact text, appended to the existing `problems` list):

- `` `coverage` must be an object `` — when present and not a plain object.
- `` `coverage.required` must list configured checks, rules, web, specs, fixtures or session names `` —
  not an array of strings, or any name not in `requirableNames(config)` (C4).
- `` `coverage.minSpecs` must be a positive integer and requires `web.specs` ``.
- `validSession` additionally rejects `expectSelector` that is present but not a
  nonempty (trimmed) string; the existing sessions message covers it.

`config-fields.mjs` gains entries `coverage` and `web.sessions` help mentions
`expectSelector` (wording is engine's; keep the existing entry style).

## C2. Web stage summary (owner: stages, `src/stages/web.mjs`)

Sweep-mode summary gains three fields; everything existing stays:

```js
{
  built: true, pages, shape, faultVisits, sessions, accessibility, keyboard, variantCount, specs?,
  pagesFailed: number,        // healthy visits whose navigation threw (check 'navigation')
  faultVisitsFailed: number,  // fault visits whose navigation threw (check 'fault-navigation')
  sessionChecks: {            // only sessions with expectSelector; {} when none
    [sessionName]: { checked: number, failed: number, examples: string[] /* first 3 `where` strings of failed visits */ }
  },
}
```

Session assertion: for healthy (non-fault) sweep visits of a session with
`expectSelector`, after the page settles, `checked += 1`; if
`await page.locator(expectSelector).count() === 0` then `failed += 1`. A visit whose
navigation threw counts as checked and failed. It does **not** create a finding.
Build-failure and live summaries are unchanged (`{ built: false, pages: 0 }`,
`{ pages: 0, specs }`).

## C3. Specs summary (owner: stages, `src/stages/specs.mjs`)

```js
{ mode: 'replay' | 'live', passed, failed, skipped,     // existing, same meaning
  flaky: number,       // report.stats.flaky ?? 0
  selected: number,    // expected + unexpected + flaky + skipped from report.stats; 0 without a report
  completed: boolean } // report parsed AND not the runner-failure case (exitCode != 0 with no spec findings)
```

## C4. `src/completeness.mjs` (owner: engine; pure, no I/O, no imports beyond stdlib)

```js
/** Names usable in coverage.required for this (raw or normalized) config. */
export function requirableNames(config): string[]
//  check names (config.checks[].name), 'rules', and when config.web: 'web', 'fixtures' if web.api,
//  'specs' if web.specs, and each web.sessions[].name that has expectSelector.

/** Fixture identity recorded in reports; null when fixtures is null. */
export function describeFixtures(fixtures, now = Date.now()):
  { recordedAt: string, hash: string, ref: string|null, sha: string|null /* 7 chars */, ageDays: number /* floor */ } | null

/** Whether the base comparison can be trusted. */
export function assessBaseline({ config, skip, headStages, baseStages, baseSha, headSha, workingTree, cached, error, liveAuth }):
  { status: 'compared' | 'cached' | 'same-commit' | 'none' | 'failed', reason: string | null }
//  liveAuth -> none 'live authentication runs without a baseline'
//  !baseSha -> none 'disabled by --no-baseline'
//  baseSha === headSha && !workingTree -> same-commit null
//  error -> failed `base run failed: ${first line of error.message}`
//  any item of kind 'check' or 'stage' executed on head but not on base (C5 items built
//      from each side's stages; specs/session/fixtures excluded because a branch may add
//      spec files the base lacks) -> failed `base did not run: ${names.join(', ')}`
//  else cached ? 'cached' : 'compared', null

/** The completeness record stored as report.json `completeness`. */
export function assessCompleteness({ config, skip, stages, fixtures, baseline, liveAuth, now = Date.now() }): Completeness

/** One line shared by Markdown, HTML and dashboard. */
export function summarizeCompleteness(completeness): string
```

`skip` is a `Set` of stage names; `stages` is `head.stages` (runner output).
`fixtures` is the loaded fixtures object or null.

```ts
type Completeness = {
  status: 'complete' | 'incomplete',
  gaps: string[],                 // why incomplete; [] when complete
  items: Item[],
  counts: {
    pages: { expected, executed, failed, skipped } | null,   // null without web or in live mode
    faultVisits: { executed, failed } | null,                 // null unless web summary has faultVisits > 0
    specs: { selected, executed, passed, failed, flaky, skipped, min: number|null } | null, // null when no specs summary
  },
  fixtures: ReturnType<describeFixtures>,
  baseline: ReturnType<assessBaseline>,
  level: null,                    // QA-08 not implemented
}
type Item = { name: string, kind: 'check' | 'stage' | 'specs' | 'session' | 'fixtures',
              required: boolean, status: 'executed' | 'skipped' | 'missing', reason: string | null }
```

## C5. Item rules (in this order; one item per name)

1. Each `config.checks[]` (kind `check`): `--skip static` -> skipped `--skip static`;
   name present in `stages.static` array -> executed; else missing — reason
   `dependency install failed` if `stages.static` has `{ name: 'install', status: 'FAIL' }`,
   else `did not run`.
2. `rules` (stage): `stages.rules === 'skipped'` -> skipped `--skip rules`; else executed.
3. `web` (stage, only when `config.web`): liveAuth -> skipped
   `live authentication runs project specs only`; skip has web -> skipped `--skip web`;
   `stages.web === 'skipped'` -> missing `dependency install failed`;
   `stages.web.built === false` -> missing `build failed`; else executed.
4. `specs` (specs, only when `config.web?.specs`): if the web item is skipped or missing
   (and not liveAuth) -> same status and reason; no `stages.web.specs` -> missing
   `did not run`; `selected === 0` -> missing `selected zero tests`;
   `!completed` -> missing `runner could not complete`; else executed.
5. Each session with `expectSelector` (session): web skipped/missing (or liveAuth ->
   skipped `live authentication`) -> same; `sessionChecks[name]` absent or
   `checked === 0` -> missing `not visited`; `failed > 0` -> missing
   `expected state not reached on ${failed}/${checked} visits (${expectSelector} not found)`;
   else executed.
6. `fixtures` (fixtures, only when `config.web?.api` and not liveAuth): fixtures null ->
   missing `no fixtures recorded; run spotter record ${config.name}`; else executed.

`required` = name in `config.coverage.required`.

## C6. Gaps (in this order)

- each missing item: `${name}: ${reason}`
- each required skipped item: `${name}: required but skipped (${reason})`
- `counts.pages.failed > 0`: `${failed} of ${expected} page visits failed to load`
- `counts.faultVisits.failed > 0`: `${failed} fault visits failed to load`
- `minSpecs` and `counts.specs.executed < min`: `specs: ${executed} executed, minimum ${min}`
  (when there is no specs summary, executed is 0)
- `baseline.status === 'failed'`: `baseline: ${baseline.reason}`

`status` = gaps.length ? 'incomplete' : 'complete'.

Pages counts: `expected = routes × viewports × colorSchemes × sessions` from config;
when the web item is executed: `failed = pagesFailed ?? 0`, `executed = pages - failed`;
otherwise executed = failed = 0. `skipped = expected - executed - failed`.
Specs counts: `executed = selected - skipped`, others copied, `min = coverage.minSpecs`.

## C7. `summarizeCompleteness` format

Parts joined by ` · `, omitted when not applicable:

1. `COMPLETE` or `INCOMPLETE`
2. pages: `${executed}/${expected} configured page visits loaded`
3. specs: `specs ${executed} of ${selected} executed` + (` (min ${min})` when min)
4. `baseline ${status}`
5. fixtures: `fixtures ${recordedAt.slice(0, 10)} (${ageDays}d old, ${hash})`
6. skipped non-required items: `skipped: ${name} (${reason}), …`

Example: `COMPLETE · 66/66 configured page visits loaded · specs 24 of 24 executed (min 20) · baseline cached · fixtures 2026-10-20 (3d old, a1b2c3d4e5)`

## C8. Run output (owner: surface)

- `report.json`: `run.completeness` (C4) and `run.fixtures = describeFixtures(fixtures)`.
- Exit codes: `EXIT_INCOMPLETE = 3`. Order: thrown error 2 > incomplete 3 > new
  blocking finding 1 > 0. `activity.finish('incomplete')` for 3.
- `loadOrRunBase` returns `{ side, cached }`; a rejected base becomes
  `{ error }` (no abort). With a failed baseline the comparison treats every head
  finding as new (same as no base).
- Markdown: `RESULT: INCOMPLETE — …` when incomplete (counts text unchanged), then
  `## Incomplete coverage (${gaps.length})` with `- ${gap}` lines; in `## Checks` add
  `- coverage: ${summarizeCompleteness(...)}` as the last check line. A run without
  `completeness` (old reports, tests) renders exactly as today.
- HTML: `<h2>Coverage</h2>` with the summary line, gaps list when incomplete, and an
  items table (name, kind, required yes/no, status, reason), all escaped.
- Dashboard `readRun`: `status = 'incomplete'` when `report.completeness?.status ===
  'incomplete'` (before the fail/pass check; error/stale rules unchanged); adds
  `coverage: summarizeCompleteness(report.completeness)` or null and
  `gaps: report.completeness?.gaps ?? []`.
- Dashboard badge: `incomplete: ['warning', '◐']`, label `INCOMPLETE`.

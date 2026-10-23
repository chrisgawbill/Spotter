# QA-08 testing levels — frozen contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

## C1 `src/levels.mjs` (engine)

Pure module. Imports only `node:crypto`. Every function tolerates a config missing
`levels`, `checks`, `coverage`, `rules` or `web` (the dashboard tests pass a mock
`{ repo, baseBranch }`): treat missing arrays as `[]`, missing objects as `null`.

```js
export const LEVELS = ['low', 'medium', 'high'];

/** Wider coverage high would add; none is implemented yet. Listed, never enabled. */
export const UNSUPPORTED_AT_HIGH = [
  { name: 'browser matrix', ticket: 'QA-12', reason: 'not implemented' },
  { name: 'data edge cases', ticket: 'QA-13', reason: 'not implemented' },
  { name: 'recovery scenarios', ticket: 'QA-11', reason: 'not implemented' },
  { name: 'performance budgets', ticket: 'QA-15', reason: 'not implemented' },
];

/** Problems with a raw `levels` block (string messages; [] when valid or absent). */
export function levelProblems(rawConfig) → string[]

/** Normalized `levels`: null when the block is absent. */
export function normalizeLevels(rawLevels) → null | { default: 'low'|'medium'|'high'|null, low: null | { routes: string[], specs: null | { grep: string } } }

/** The execution plan for one run. Throws Error on an unknown or unconfigured level. */
export function resolvePlan(config, selected) → Plan

/** One line shared by CLI, activity, dashboard preview and reports. */
export function summarizePlan(plan) → string
```

```ts
type Plan = {
  config: NormalizedConfig;          // effective config; the input object itself when nothing narrows
  skip: Set<'rules'>;                // stages excluded by the level (merged with --skip by the CLI)
  record: LevelRecord | null;        // null when no level is selected and no default is set
  hash: string;                      // 10 hex chars
};
type LevelRecord = {
  name: 'low' | 'medium' | 'high';
  source: 'selected' | 'default';
  exclusions: Exclusion[];
  unsupported: { name: string, ticket: string, reason: string }[];   // UNSUPPORTED_AT_HIGH at high, else []
};
type Exclusion = {
  name: string;
  kind: 'check' | 'stage' | 'specs' | 'route' | 'viewport' | 'colorScheme' | 'faults' | 'coverage';
  reason: string;                    // exactly `excluded at level low`
};
```

### `levelProblems(raw)` messages (exact text)

- `levels` not a plain object → `` `levels` must be an object with optional default and low ``
- any key other than `default`, `low` → same message as above
- `default` not in LEVELS → `` `levels.default` must be low, medium or high ``
- `default: low` without `low` → `` `levels.default: low` requires `levels.low` ``
- `low` not a plain object, or keys other than `routes`, `specs` → `` `levels.low` accepts routes and specs ``
- web set and `low.routes` not a nonempty array of unique strings that are all names in `web.routes`
  (routes may be strings, whose name is the string) → `` `levels.low.routes` must list configured web route names ``
- web not set and `low.routes` present → same routes message
- `low.specs` present and not `{ grep: nonempty string }` (no other keys), or `web.specs` absent → `` `levels.low.specs` needs a string grep and requires `web.specs` ``

### `resolvePlan(config, selected)` rules

1. `selected` is `undefined`/`null`/`''` (no choice) or a string. A string not in LEVELS throws
   `` Unknown level "<x>"; use low, medium or high ``.
2. `name = selected || config.levels?.default || null`; `source = selected ? 'selected' : 'default'`.
3. `name === 'low'` and no `config.levels?.low` throws
   `` Level low is not configured; add levels.low to projects/<config.name>.yml ``.
4. `name` null, `medium` or `high`: `config` unchanged (same object), `skip` empty,
   `exclusions` []. `unsupported` = `UNSUPPORTED_AT_HIGH` for high, else []. `record` null when `name` null.
5. `low`, with `required = config.coverage?.required ?? []` and `low = config.levels.low`:
   - checks: keep checks whose name is in `required`; each other check → `{ name, kind: 'check' }`.
   - rules: unless `'rules'` is in `required`, `skip.add('rules')` and exclude `{ name: 'rules', kind: 'stage' }`.
   - web (only when `config.web`):
     - routes: keep routes whose `name` is in `low.routes` (config order); others → `{ name: route.name, kind: 'route' }`.
     - viewports: keep the first; others → `{ name: String(width ?? value), kind: 'viewport' }` (object viewports use `.width`).
     - colorSchemes: keep the first; others → `{ name: scheme, kind: 'colorScheme' }`.
     - faultInjection: set `null`; if it was non-null → `{ name: 'fault visits', kind: 'faults' }`.
     - sessions: unchanged.
     - specs: if `low.specs` → `{ ...web.specs, grep: low.specs.grep }`; else if `'specs'` in `required` → unchanged;
       else remove (set `specs` to `undefined` by omitting it) → `{ name: 'specs', kind: 'specs' }`.
   - coverage: `required` unchanged. `minSpecs` kept only when the effective specs equal the original
     (unchanged object); otherwise if it was set → `minSpecs: null` and `{ name: 'minSpecs', kind: 'coverage' }`.
   - Every exclusion's `reason` is `excluded at level low`. A name in `required` is never excluded.
   - Return a new config object (`{ ...config, checks, web: { ...web, … }, coverage: { … } }`); never mutate the input.
6. `hash = sha1(JSON.stringify({ name, skip: [...skip].sort(), config: effective })).hex.slice(0, 10)`.

### `summarizePlan(plan)` (exact format, parts joined with ` · `)

1. `level <name> (<source>)`, or `no level` when record is null.
2. `<n> checks` (count of effective checks; `1 checks` is fine — keep it simple).
3. `rules` or `no rules` (`no rules` when `skip` has `rules`).
4. When `config.web`: `<r> routes × <v> viewports × <s> schemes × <n> sessions` (counts from the effective
   web; sessions from `web.sessions?.length ?? 1`), then ` + fault visits` appended when `faultInjection` is set.
5. When effective `web.specs`: `specs` or `specs (grep <grep>)` when grep is set.
6. When exclusions: `excluded: <name>, <name>, …` (all names, in exclusion order).
7. When unsupported: `unsupported: <name> (<ticket>), …`.

## C2 config (engine)

- `normalizeConfig` pushes `...levelProblems(config)` into `problems`, and returns
  `levels: normalizeLevels(config.levels)` in the normalized object.
- `src/config-fields.mjs` gains (after `coverage`):
  `levels: { label: 'Testing levels', type: 'object', example: 'levels:\n  default: medium\n  low:\n    routes: [home]\n    specs: { grep: "@smoke" }', help: 'Optional. low runs only coverage.required checks and the listed routes at the first viewport and colour scheme; medium is the full configured run; high currently equals medium. Select per run with --level or the dashboard.' }`

## C3 completeness (engine)

- `assessCompleteness({ config, skip, stages, fixtures, baseline, liveAuth, level = null, now })`:
  `config` is the plan's effective config. Each `level.exclusions` entry becomes an item
  `{ name, kind, required: false, status: 'excluded', reason }` appended after the existing items.
  Excluded items are never gaps. Items from `listItems` whose name and kind match an exclusion are dropped
  before the exclusions are appended (this replaces the `rules` "skipped" item with the exclusion). Returns `level` (the LevelRecord or null) instead of the literal `null`.
- `summarizeCompleteness(c)`: when `c.level` is set, insert `level <name>` directly after the status word,
  and append `<n> excluded by level` after the skipped part when there are excluded items.
- `assessBaseline` signature unchanged.

## C4 CLI (surface)

- `parseArguments`: `--level <value>` → `options.level` (string). Unknown values throw
  `` Unknown level "<x>"; use low, medium or high `` (import `LEVELS`).
- `runCommandLine`: `--level` with `record` throws `--level applies to run only`; with `--live-auth` throws
  `--level cannot be combined with --live-auth`.
- `runProject`: first thing after loading: `const plan = options.liveAuth ? { config, skip: new Set(), record: null, hash: 'live' } : resolvePlan(config, options.level)`.
  Then `log(\`plan: ${summarizePlan(plan)}\`)`. Use `plan.config` wherever `config` is used for side runs,
  `assessBaseline` and `assessCompleteness`; `runSkip = new Set([...options.skip, ...plan.skip])` for `runSide` /
  `loadOrRunBase` and the cache key's skip part; `assessBaseline` and `assessCompleteness` receive `skip: options.skip`
  and `assessCompleteness` receives `level: plan.record`. Append `-${plan.hash}` to the cache key.
  `createActivity` metadata gains `level: plan.record?.name ?? null, plan: summarizePlan(plan)`.
  `run` gains `plan: summarizePlan(plan)` (after `fixtures`).
- `USAGE` documents `[--level low|medium|high]`.

## C5 reports (surface)

- `report.mjs`: a `- plan: <run.plan>` line directly before the existing `- coverage:` line when `run.plan` is set.
- `htmlReport.mjs` coverage section: when `completeness.level?.unsupported.length`, a paragraph
  `Not available at level high: <name> (<ticket>), …` after the summary. Excluded items already appear in the item table.

## C6 dashboard server (surface)

- `GET /api/plan?project=<name>&level=<''|low|medium|high>`: unknown/unsafe project → 404 `{ error: 'Unknown project' }`;
  `resolvePlan` throws → 400 `{ error: message }`; else 200
  `{ level: record?.name ?? null, source: record?.source ?? null, summary: summarizePlan(plan), exclusions: record?.exclusions ?? [], unsupported: record?.unsupported ?? [] }`.
- `/api/projects` entries gain `levels: { default: config.levels?.default ?? null, low: !!config.levels?.low }`.
- `POST /api/runs` body `{ project, branch, level? }`: `level` absent/`''` = project default. Otherwise it must be a
  string; run `resolvePlan(config, level)` before the busy check and return 400 `{ error: message }` on throw.
  Launch args append `'--level', level` only when a level was sent. `metadata.level = level || null`.
- `readRun` result gains `plan: activity?.plan ?? report?.plan ?? null`.

## C7 dashboard page (surface)

- `index.html` start form, after the Branch label:
  `<label class="ds-field">Level<select id="level" class="ds-input"><option value="">Project default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>`;
  after `#project-info`: `<p id="plan" class="muted" role="status"></p>`.
  In `.run-meta`, after `#identity`: `<p id="run-plan" class="muted" hidden></p>`.
- `dashboard.js`: on project change and level change, fetch `/api/plan` and write `Plan: <summary>` into `#plan`;
  on error write the message into `#plan` and disable `#submit`. Label the default option
  `Project default (<default>)` or `Project default (none)`; disable the Low option when `levels.low` is false.
  Keep the chosen level across background refreshes. POST sends `level` only when non-empty.
  Activity page: `#run-plan` text = `Plan: <run.plan>`, hidden when null.
- Status must not depend on colour; no new dependencies.

# Brief: engine (wave 1, runs in parallel with sweep)

This brief is your primary context and is meant to be complete. But it is a summary
written by someone else, and it can be stale or wrong. If the actual code contradicts
it, **the code wins** — follow the code, and report the discrepancy to the coordinator.
Read beyond this brief when you genuinely need to; just don't re-read the full plan to
rediscover what is already written here.

**When you need context or judgement this brief does not give you, ask the coordinator
rather than working it out yourself.** Send it with
`SendMessage({to: "main", message: "..."})` — you are a background subagent, so `"main"`
reaches the coordinating Opus session that briefed you. Say what you were doing, the
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

## Ponytail (implementation style)
Understand the flow first, then: reuse what exists (C1 helpers, existing patterns), no
new dependencies, no unrequested abstractions, shortest complete diff. Ponytail governs
how you write code inside the contract, never whether a contracted item is built.

## Your files (allow-list)
- `src/config.mjs`, `src/levels.mjs`, `src/completeness.mjs`, `src/config-fields.mjs`
- `test/config.test.mjs`, `test/levels.test.mjs`, `test/completeness.test.mjs`

Deny-list: `src/browsers.mjs` (coordinator, frozen — import from it). The `sweep` agent is
editing `src/stages/web.mjs`, `src/stages/specs.mjs`, `src/config-drift.mjs`,
`test/config-drift.test.mjs` and `integration/*` **right now**. Docs/README belong to the coordinator.

## Task (contracts C2–C5, pasted below)
1. config.mjs: defaults + validation (C2). Import `matrixProblems` from `./browsers.mjs`.
2. levels.mjs: `levels.high` validation/normalization, high union, low narrowing, summarizePlan matrix part,
   drop `browser matrix` from UNSUPPORTED_AT_HIGH (C3).
3. completeness.mjs: expected visits via `countPageVisits` (C4).
4. config-fields.mjs: new fields and levels help (C5).

## Keep
- No level/no default → `resolvePlan` returns the config object unchanged (`plan.config === config`).
- Existing low narrowing (checks, rules, config stage, routes, first viewport/scheme, faults, specs, minSpecs).
- `summarizePlan` output for default-matrix configs byte-identical (existing tests assert it).
- Plan hash still derived from the effective config (so the matrix is part of baseline cache identity automatically).
- None of these files may import `playwright` (host Node 18).

## Required tests
- config: defaults `browsers: ['chromium']`, `devices: []`; invalid browser / duplicate device rejected with the C1 messages.
- levels: high with `levels.high` unions browsers/devices in order, deduped, no exclusions; high without `levels.high`
  leaves config unchanged; low keeps only the first browser and drops devices with `browser`/`device` exclusions;
  `levels.high` without web, with unknown keys, or empty is rejected; summarizePlan shows
  `matrix chromium, firefox, iPhone 13` for a non-default matrix and nothing for default; UNSUPPORTED_AT_HIGH has 3
  entries (update the existing `/unsupported: browser matrix/` assertion in test/levels.test.mjs).
- completeness: expected page count with 2 browsers + 1 device.

## Verify
`npm test` (host). Baseline 149 pass. You may run the full unit suite; ignore failures only in
`test/config-drift.test.mjs` if sweep is mid-edit, and say so.

Report: `docs/plans/browser-matrix-progress/engine.md` ending with `## ESCALATIONS`.

## Contracts (frozen)
## C1 `src/browsers.mjs` (landed; read-only for agents)

```js
export const BROWSERS = ['chromium', 'firefox', 'webkit'];
export const DEFAULT_TARGET_ID = 'chromium';
// Target = { id, browser: string|null, device: string|null, label }
export function listTargets(web)        // browsers first, then devices; [0] is the primary case
export function isDefaultMatrix(web)    // browsers == ['chromium'] && devices == []
export function countPageVisits(web)    // browsers×viewports×routes×schemes×sessions + devices×routes×schemes×sessions
export function matrixProblems(raw, where) // string[]; where = 'web' or 'levels.high'
```

Must stay free of any `playwright` import (host Node 18 runs unit tests; Playwright needs 20).

## C2 config (`src/config.mjs`)

- `WEB_DEFAULTS` gains `browsers: ['chromium']`, `devices: []`.
- `normalizeConfig` pushes `...matrixProblems(config.web, 'web')` inside the `if (config.web)` block.
- Normalized `web.browsers` / `web.devices` are always arrays.

## C3 levels (`src/levels.mjs`)

- Raw `levels` accepts keys `default`, `low`, `high`. `levels.high` accepts only `browsers`, `devices`;
  needs at least one of them; requires `web`; validated with `matrixProblems(high, 'levels.high')`.
  Message for shape errors: ``'`levels.high` accepts browsers and devices and requires `web`'``.
- `normalizeLevels` adds `high: rawLevels.high ? { browsers: rawLevels.high.browsers ?? [], devices: rawLevels.high.devices ?? [] } : null`.
- `UNSUPPORTED_AT_HIGH` drops the `browser matrix` entry (three entries remain).
- `resolvePlan(config, 'high')` with `config.levels?.high` and `config.web`: effective
  `web.browsers = unique([...web.browsers, ...high.browsers])`, same for devices (order kept). Nothing
  else changes; no exclusions. Without `levels.high`, high leaves the config untouched as today.
- low (`narrowToLow`): `browsers: web.browsers.slice(0, 1)`, `devices: []`; each dropped browser →
  exclusion `{ name, kind: 'browser' }`, each device → `{ name, kind: 'device' }`, reason as today.
- `summarizePlan`: when `config.web` and `!isDefaultMatrix(config.web)`, push right after the routes part:
  `` `matrix ${listTargets(web).map((t) => t.label).join(', ')}` ``. Default matrix: output unchanged.

## C4 completeness (`src/completeness.mjs`)

- `counts.pages.expected = countPageVisits(config.web)` (replaces the inline product).

## C5 config fields (`src/config-fields.mjs`)

Add after `web.colorSchemes`:
- `'web.browsers'`: label `Browsers`, type `list`, example `'  browsers: [chromium, firefox, webkit]'`, help:
  `'Inside web, choose chromium, firefox and/or webkit. Default: chromium. The first browser also runs fault visits, accessibility and keyboard checks.'`
- `'web.devices'`: label `Emulated devices`, type `list`, example `"  devices: ['iPhone 13', 'Pixel 7']"`, help:
  `'Inside web, list Playwright device names. Each runs in its own engine at its own viewport (emulation, not a real phone). Default: none.'`
- `levels` help: replace "high currently equals medium" with "high adds levels.high browsers and devices"; example gains
  `'\n  high:\n    browsers: [firefox, webkit]'`.


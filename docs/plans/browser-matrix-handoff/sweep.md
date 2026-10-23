# Brief: sweep (wave 1, runs in parallel with engine)

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
- `src/stages/web.mjs`, `src/stages/specs.mjs`, `src/config-drift.mjs`
- `test/config-drift.test.mjs`, `integration/browser-matrix.test.mjs` (new)

Deny-list: `src/browsers.mjs` (coordinator, frozen — import from it). The `engine` agent is editing
`src/config.mjs`, `src/levels.mjs`, `src/completeness.mjs`, `src/config-fields.mjs` and their tests
**right now**. Until engine lands, `normalizeConfig` may not yet default `web.browsers`/`web.devices`:
in your integration test pass `browsers`/`devices` explicitly for matrix configs; for the legacy config
test, if defaults are not there yet, tell the coordinator rather than adding fallbacks in web.mjs
(web.mjs may assume normalized arrays).

## Task (contracts C6–C8, pasted below)
1. web.mjs: targets, one browser per engine via `launchBrowsers`, device options, job `target`,
   identity suffixes/keys, primary-only faults/axe/keyboard, record primary only, summary shape/targets, pass
   `projects` to `runSpecsStage`. Import `devices`, `firefox`, `webkit` from `playwright` here only.
2. specs.mjs: accept `projects` and write it into the generated config (C7). No playwright import.
3. config-drift.mjs: variant key includes target (C8).

Anchors: `src/stages/web.mjs:44` (chromium.launch), `:45` listPageJobs call, `:50-58` fault jobs,
`:72` specs call, `:100-105` listPageJobs, `:140-141` screenshotName/where,
`:146` newContext, `:166-172` api-not-replayed problem, `:213` axe, `:220` keyboard, `:245` finding key.
`src/stages/specs.mjs:38-42` generated config. `src/config-drift.mjs:58` variant.

## Keep
- Default matrix (`browsers: ['chromium']`, no devices): screenshot names, `where`, finding keys, `shape`,
  spec config (no `projects`) byte-identical to today.
- Live-auth path (`web.specs.mode === 'live'`) untouched.
- Session secret redaction, storageState screenshot suppression, fault logic, clock freezing.
- `launchBrowsers` closes every launched browser in the `finally` (today: `browser?.close()`).

## Required tests
- `integration/browser-matrix.test.mjs` (pattern: integration/browser-depth.test.mjs and integration/specs.test.mjs):
  1. Same journey (one route, static page, a tiny replay spec) with `browsers: [chromium, firefox, webkit]`,
     `devices: ['iPhone 13']`, faultInjection false: healthy run has no high/medium findings, `summary.pages === 4`,
     four distinct screenshot files, specs ran in 4 projects (`summary.specs.selected === 4`).
  2. Seeded defect that throws only when `navigator.userAgent` includes `Firefox`: new findings vs healthy
     (`compareWithBaseline`) are only firefox ones (`where` ends with ` firefox`), including a firefox spec failure.
  3. `launchBrowsers(['firefox'], { firefox: { launch: async () => { throw new Error("Executable doesn't exist at /x") } } })`
     rejects with the C6 message.
  4. Unknown device rejects with the C6 message before building (use a build command that would fail, e.g. `false`).
  5. Legacy config (no browsers/devices): screenshot name and `where` have no suffix; shape has no ` in `.
- `test/config-drift.test.mjs`: two targets with identical light/dark screenshots in only one target do not
  produce `color-scheme-no-effect` (existing tests pass jobs without `target`; keep them passing).

## Verify
- `node --test test/config-drift.test.mjs test/specs.test.mjs` on host (do not run the full unit suite; engine is editing).
- In Docker: `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/browser-matrix.test.mjs integration/browser-depth.test.mjs integration/specs.test.mjs`
  Device emulation, Firefox and WebKit claims must come from this run, not from reasoning.

Report: `docs/plans/browser-matrix-progress/sweep.md` ending with `## ESCALATIONS`.

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

## C6 sweep (`src/stages/web.mjs`)

- Job shape gains `target` (a C1 Target). Device jobs: `viewport` = descriptor viewport.
- `listPageJobs(web, mode)`: sweep = every target; record = primary target only, first colour scheme (as today).
- Exported `launchBrowsers(engines, types = { chromium, firefox, webkit })` → `Map(engine → Browser)`;
  on launch failure throws
  `` `Cannot launch ${engine} for web.browsers/web.devices: ${firstLine(error.message)}. Rebuild the Spotter image (bin/spotter build-image) or remove ${engine} from the configuration.` ``
  and closes any already-launched browsers.
- Exported `deviceOptions(name)` → Playwright descriptor without `defaultBrowserType`, plus `engine` returned separately:
  returns `{ engine, options }`; unknown name throws
  `` `Unknown Playwright device "${name}" in web.devices; use a name from Playwright's device list such as "iPhone 13".` ``
  Resolve every device at the start of `runWebStage` sweep/record (before the build).
- Context options: device target → `{ ...options, colorScheme, storageState, serviceWorkers: 'block', reducedMotion: 'reduce' }` (device viewport, UA, DPR, touch); browser target → as today.
- Identity for non-default targets (`target.id !== DEFAULT_TARGET_ID`): finding key `browser: target.id`;
  `where` suffix `` ` ${target.label}` ``; screenshot name suffix `` `-${target.id}` `` (after the session, before any fault suffix).
  The Chromium target adds nothing. `api-not-replayed` keeps one finding across cases: its key sets `browser: undefined`.
- Primary case only: fault jobs, `runAccessibility`, `runKeyboardSmoke`.
- Summary: `pages` = all jobs; `shape` = today's string, plus, when `!isDefaultMatrix(web)`,
  `` ` in ${targets.map((t) => `${t.label} ${n}`).join(', ')}` `` with `n` = that target's job count.
  `summary.targets = targets.map((t) => ({ id: t.id, label: t.label, pages: n }))`.
- Live-auth path unchanged.

## C7 specs (`src/stages/specs.mjs`)

- `runSpecsStage({ ..., projects = null })`. When `projects` is a non-empty array and not live, the
  generated Playwright config gets `projects` verbatim. web.mjs passes, when `!isDefaultMatrix(web)`,
  `targets.map((t) => ({ name: t.id, use: t.device ? deviceDescriptor : { browserName: t.browser } }))`
  where `deviceDescriptor` is the full Playwright descriptor (including `defaultBrowserType`); otherwise `null`.
- specs.mjs must not import `playwright` (host unit tests import it).

## C8 scheme check (`src/config-drift.mjs`)

- `findIneffectiveSchemes`: the variant key includes the target: `` `${job.target?.id ?? ''} ${job.viewport.width} ${job.session.name}` ``.

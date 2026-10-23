# QA-12 contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

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

> Superseded 2026-10-23 by the Product Owner: no `levels.high`; high unions `BROWSERS` and
> `HIGH_DEVICES = ['iPhone 13', 'Pixel 7']` into every web config. Low and summarizePlan as below.

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

## C6 sweep (`src/stages/web.mjs`)

- Job shape gains `target` (a C1 Target). Device jobs: `viewport` = descriptor viewport.
- `listPageJobs(web, mode)`: sweep = every target; record = primary target only, first colour scheme (as today).
- Exported `launchBrowsers(engines, types = { chromium, firefox, webkit })` → `Map(engine → Browser)`;
  on launch failure throws
  `` `Cannot launch ${engine}: ${firstLine(error.message)}. Rebuild the Spotter image (bin/spotter build-image); ${engine} is needed at level high and wherever web.browsers or web.devices use it.` ``
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

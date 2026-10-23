# Brief: coder-ui

Repo: /home/chris_dev/projects/Spotter

## Your files (only these)
src/dashboard/index.html, src/dashboard/dashboard.js, src/dashboard/dashboard.css,
integration/dashboard.test.mjs, docs/dashboard.md.
Concurrently: coder-server adds the API routes in src/dashboard.mjs; coder-core changes src/prune.mjs.
Code against the API exactly as the contract states.

## Task
1. index.html: add the Storage nav link and `#storage-page` section (after `#config-page`).
   Structure: a `ds-card ds-aero-surface ds-stack` "Cleanup settings" card with the form
   (`ds-field` labels, `ds-input` inputs; checkbox labelled "Clean up automatically after each run");
   a short muted note that the latest run and in-progress runs are always kept; then a
   "Disk usage" section with `section-head` (h3/h2 + `#refresh-storage` secondary button),
   a `ds-table-wrap` > `ds-table` with columns Project, Runs, Cached base results, Work folders,
   Cleanup would remove; `#storage-total`; `#cleanup-now` (class `ds-button button-danger`);
   `#cleanup-message`. Match existing markup style (one-line-ish elements, existing classes).
2. dashboard.js:
   - `refresh()` currently toggles two pages by `location.hash === '#configs'` (lines 103-110).
     Generalize to three pages (runs / #configs / #storage) including titles, `hidden`, and
     `aria-current` on nav links. Keep the run page as the default for every other hash (incl. #run/...).
   - Load storage via `api('/api/storage')` when entering #storage (hashchange and initial load),
     on #refresh-storage, after save and after cleanup. Not on the 2 s interval.
   - Render rows: counts and formatted sizes; "Cleanup would remove" shows `<n> item(s) · <size>`
     or 'Nothing to remove', plus the skipped text when non-null. Use `escape` and `html()` helpers.
   - Form: fill inputs from settings; locked -> disabled + help text per contract. Track unsaved
     changes (input event) -> disable cleanup with the contract message. Submit -> PUT /api/retention
     with numbers (`Number(value)`) and boolean; show 'Settings saved.' or the error in #retention-message.
     Reuse `configRequest` for JSON requests.
   - Cleanup per contract (confirm text, message text, reload).
   - Do not add the storage form to the existing `beforeunload` dirty guard for configs; leave config logic untouched.
3. dashboard.css: only what's needed (e.g. checkbox label layout, number input width,
   right-aligned numeric cells). Reuse tokens (`--ds-space-*`, colors). Must work at 375 px width
   (table scrolls inside `ds-table-wrap`, no page horizontal scroll).
4. integration/dashboard.test.mjs: add a short block (inside the existing test, before teardown,
   or a second small test using the same server pattern) that opens `#storage`, waits for
   `#storage-projects` rows, changes `#keep-runs`, sees cleanup disabled with the unsaved message,
   saves, sees 'Settings saved.', and reaches `#keep-runs` by keyboard (Tab) from the nav. Do not run it
   (needs the Docker image); the coordinator will.
5. docs/dashboard.md: add a "## Storage" section (before "## Verification"): what the page shows,
   editable settings and where they're saved (`retention.json` in the Spotter data folder), env
   variables lock fields, Clean up now behavior and what is always kept, and that sizes are computed
   when the page opens.

## Keep
- All functional element IDs and behaviors: branch selection, live progress, reloadable run links,
  report iframe (sandboxed), config editor dirty/stale protections, focus handling in `html()`.
- Status text must be understandable without color.

## Verify
- `node --check src/dashboard/dashboard.js` (it's an ES module; if --check complains about top-level
  await, use `node --input-type=module --check < src/dashboard/dashboard.js`).
- `node --check integration/dashboard.test.mjs`.
- Do not run the full suite. Never run bin/spotter or touch ~/spotter.

## Contract (pasted from docs/plans/storage-ui-contracts.md)
# Storage page contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

Builds on the shipped retention commit (4cf936c). Settings can now also be saved
from the dashboard to `<SPOTTER_HOME>/retention.json`.
Precedence: CLI flags > env (`SPOTTER_KEEP_RUNS`, `SPOTTER_KEEP_BASELINES`,
`SPOTTER_AUTO_PRUNE`) > saved file > defaults (10, 5, on).

## `src/prune.mjs` additions / changes

```js
export const RETENTION_FILE = 'retention.json';

/**
 * CHANGED: third parameter. Precedence overrides > env > saved > defaults.
 * saved = { keepRuns?, keepBaselines?, autoPrune? } from loadSavedRetention.
 * saved.keepRuns / saved.keepBaselines validated with the same whole-number rule,
 * error names 'Saved keepRuns' / 'Saved keepBaselines'.
 * saved.autoPrune: boolean; anything else (and not undefined) -> throw new Error('Saved autoPrune must be true or false').
 * env.SPOTTER_AUTO_PRUNE (when set) beats saved.autoPrune; existing env parsing unchanged.
 */
export function retentionSettings(env = process.env, overrides = {}, saved = {}) // -> { keepRuns, keepBaselines, autoPrune }

/** Which settings env fixes: a variable counts as set when defined and not ''. */
export function lockedRetention(env = process.env) // -> { keepRuns: boolean, keepBaselines: boolean, autoPrune: boolean }

/** Saved settings from path.join(home, RETENTION_FILE); missing file or invalid JSON or non-object -> {}. */
export async function loadSavedRetention(home) // -> Promise<object>

/**
 * Validates and writes { keepRuns, keepBaselines, autoPrune } to path.join(home, RETENTION_FILE)
 * atomically (write `${file}.tmp` then rename). keepRuns/keepBaselines must be integers >= 0
 * (Number.isInteger), autoPrune a boolean; otherwise throw
 * Error('keepRuns must be a whole number of 0 or more') / ('keepBaselines ...') /
 * Error('autoPrune must be true or false'). Creates `home` if missing. Returns the saved object.
 */
export async function saveRetention(home, { keepRuns, keepBaselines, autoPrune }) // -> Promise<{ keepRuns, keepBaselines, autoPrune }>

/** Total bytes of regular files under target (lstat; symlinks count their own size, never followed). Missing -> 0. */
export async function directorySize(target) // -> Promise<number>

/**
 * Disk use and cleanup preview for one project. Never deletes.
 * runs.count = directory entries in runs/ except 'latest'; baselines.count = directory entries;
 * work.count = all entries. bytes = directorySize of the folder (runs/ includes everything in it).
 * cleanup = pruneProject(directories, { ...settings, dryRun: true, now }) ->
 *   { count: removed.length, bytes: sum of directorySize(removed), skipped }.
 */
export async function storageSummary(directories, { keepRuns, keepBaselines, now = Date.now() })
// -> Promise<{ runs: { count, bytes }, baselines: { count, bytes }, work: { count, bytes }, cleanup: { count, bytes, skipped: string|null } }>
```

`isActiveRun`, `pruneProject`, `DEFAULT_*` are unchanged.

## `src/cli.mjs`

Both `retentionSettings(...)` calls (in `pruneCommand` and the auto-cleanup in
`runProject`) gain a third argument `await loadSavedRetention(spotterHome)`
(`spotterHome` from `./paths.mjs`). The auto-cleanup load stays inside its try/catch.

## Dashboard HTTP API (`src/dashboard.mjs`)

`createDashboardServer` gains option `env = process.env` (used for retention only).
Project data folders: `{ runs: path.join(home, name, 'runs'), baselines: path.join(home, name, 'baselines'), work: path.join(home, name, 'work') }`
for each configured `safeName` project from `projectNames()`.
Effective settings = `retentionSettings(env, {}, await loadSavedRetention(home))`.

- `GET /api/storage` -> 200
  `{ settings: { keepRuns, keepBaselines, autoPrune }, locked: lockedRetention(env), projects: [{ name, ...storageSummary(dirs, settings) }] }`
  (projects in `projectNames()` order).
- `PUT /api/retention` — same-origin JSON required (403 `{ error: 'Same-origin JSON required' }`
  exactly like other writes), body <= 4096 bytes (413). Body `{ keepRuns, keepBaselines, autoPrune }`
  (numbers and boolean). `saveRetention(home, body)`; validation errors -> 400 `{ error: message }`.
  200 `{ settings: <effective after save>, locked }`.
- `POST /api/cleanup` — same-origin JSON required, body <= 4096 (body content ignored; client sends `{}`).
  409 `{ error: 'Wait for the run that is starting' }` while `starting`.
  For each project: `pruneProject(dirs, settings)` (real delete).
  200 `{ removed: <total count>, skipped: [<project names whose skipped was non-null>] }`.
- All three must be handled before the generic `if (req.method !== 'GET') return send(405 ...)`.
  Errors flow to the existing catch (400 with message).

## Dashboard UI (`src/dashboard/*`)

- New nav link `<a class="nav-link ds-focus-outline" href="#storage">Storage</a>` after Configurations.
- New page `<section id="storage-page" class="ds-stack" hidden aria-labelledby="storage-title">`.
  Page title/description when `#storage`: 'Keep disk use in check.' /
  'See what Spotter stores and choose how much history to keep.'
- Element IDs (frozen, used by tests):
  - Settings form `#retention-form`; inputs `#keep-runs` (type=number min=0 step=1),
    `#keep-baselines` (same), `#auto-prune` (checkbox); submit `#save-retention`;
    message `#retention-message` (role=status).
  - Usage table body `#storage-projects`; totals text `#storage-total`; button `#cleanup-now`;
    message `#cleanup-message` (role=status); refresh button `#refresh-storage`.
- Data is loaded from `GET /api/storage` when the Storage page is shown (hash becomes
  `#storage`), on `#refresh-storage`, and after save/cleanup — NOT on the 2-second poll.
- Locked fields are `disabled` and followed by help text naming the variable, e.g.
  'Set on the server by SPOTTER_KEEP_RUNS.' (connected with aria-describedby).
- Clean up now: disabled when total cleanup count is 0; `confirm('Delete <n> item(s) (<size>) now? In-progress runs and the latest run are kept.')`;
  `POST /api/cleanup` `{}`; message 'Removed <n> item(s).' plus, when skipped is non-empty,
  ' Skipped baselines and work folders for <names> because a run is in progress.'; then reload storage.
- Cleanup always uses saved settings; if the form has unsaved changes, cleanup is disabled
  and `#cleanup-message` says 'Save settings before cleaning up.'
- Sizes are formatted client-side (B, KB, MB, GB, 1 decimal above KB, base 1024).

## Coding style: Ponytail (full)
Climb this ladder and stop at the first rung that holds: does it need to exist (YAGNI)?
already in this codebase? stdlib? native platform feature? installed dependency? one line?
only then the minimum code that works. No unrequested abstractions, no scaffolding "for
later", fewest files, shortest working diff — but only after reading the code you touch.
Never simplify away input validation, error handling that prevents data loss, or anything
the contract requires. Ponytail governs how you write code inside the contract, never
whether a contracted item is built; a conflict there is an escalation.

## Context and escalation
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

## Report
Write `docs/plans/storage-ui-progress/coder-ui.md`: files changed, what each change
does, verification commands with exact output counts, anything unverified, and
`## ESCALATIONS` (or `## ESCALATIONS\nNone.`). Do not write any other progress file.

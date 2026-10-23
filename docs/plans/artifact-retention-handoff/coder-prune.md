# Brief: coder-prune

Repo: /home/chris_dev/projects/Spotter

## Your files (only these)
- `src/prune.mjs` (new)
- `test/prune.test.mjs` (new)

Do not edit anything else. coder-cli is concurrently editing `src/cli.mjs`,
`bin/spotter`, `README.md`, `docs/self-hosting.md` and
`examples/deploy/spotter-dashboard.service`; it imports your exports exactly as
named in the contract below.

## Task
1. Implement `src/prune.mjs` exactly to the contract below. Node stdlib only
   (`node:fs/promises`, `node:path`). Match the style of `src/git.mjs`: short
   one-line JSDoc on exports, no classes, no extra exports beyond the contract
   (private helpers are fine).
2. Write `test/prune.test.mjs` (node:test, node:assert/strict, temp dir) covering:
   - `retentionSettings`: defaults; env values; overrides beat env; `'0'` accepted;
     `'-1'`, `'abc'`, `'1.5'` throw with the variable/flag name in the message;
     `SPOTTER_AUTO_PRUNE` unset -> true, `'OFF'`/`'false'`/`'0'` -> false,
     `'maybe'` throws.
   - `isActiveRun`: running+fresh true; running+stale (>30 s) false; finished false; null false.
   - `pruneProject` on a fake tree (use `utimes` to set mtimes; pass `now`):
     keeps newest `keepRuns` by `startedAt` with mtime fallback for a run lacking
     activity.json; keeps the `latest` target even when it is old; keeps an active
     run beyond the count; removes baselines without `side.json`; keeps newest
     `keepBaselines` by side.json mtime; clears work entries but keeps a fresh
     `record-*` and removes a stale (>24 h) one; with an active run, baselines and
     work are untouched and `skipped` is set; `dryRun` returns the same list and
     deletes nothing; missing `baselines/`/`work/` folders do not throw.
   - Keep the test file compact: a small helper to build run/baseline dirs.

## Contract (pasted from docs/plans/artifact-retention-contracts.md)
## `src/prune.mjs`

```js
export const DEFAULT_KEEP_RUNS = 10;
export const DEFAULT_KEEP_BASELINES = 5;

/**
 * Retention counts. Precedence: overrides (CLI flags) > env > defaults.
 * Reads env.SPOTTER_KEEP_RUNS and env.SPOTTER_KEEP_BASELINES. Undefined or empty
 * string = not set. Values may be numbers or strings; each must be an integer >= 0
 * (/^\d+$/ after String()), otherwise throw
 * new Error(`<name> must be a whole number of 0 or more`) where <name> is
 * `SPOTTER_KEEP_RUNS`/`SPOTTER_KEEP_BASELINES` for env and `--keep-runs`/`--keep-baselines` for overrides.
 */
export function retentionSettings(env = process.env, overrides = {}) // -> { keepRuns: number, keepBaselines: number, autoPrune: boolean }
// autoPrune comes from env.SPOTTER_AUTO_PRUNE only (no override). Unset/empty -> true.
// Case-insensitive 'on'|'true'|'1' -> true; 'off'|'false'|'0' -> false;
// anything else -> throw new Error('SPOTTER_AUTO_PRUNE must be on or off').
// overrides shape: { keepRuns?: string|number, keepBaselines?: string|number }

/** True when activity.status === 'running' and now - Date.parse(activity.updatedAt) <= 30_000. Null/undefined activity -> false. */
export function isActiveRun(activity, now = Date.now()) // -> boolean

/**
 * Deletes (or with dryRun only lists) old artifacts in one project's data folder.
 * `directories` is the object from projectDirs() (uses .runs, .baselines, .work).
 * Missing folders are fine (treated as empty).
 * Returns { removed: string[] /* absolute paths, sorted */, skipped: string | null }.
 */
export async function pruneProject(directories, { keepRuns, keepBaselines, dryRun = false, now = Date.now() }) // -> Promise<{ removed, skipped }>
```

### Frozen rules for `pruneProject`

1. **Runs** — every directory entry in `runs/` except the name `latest`
   (symlinks and plain files are ignored). Read `activity.json` (missing or
   invalid JSON = null). Order newest first by `activity.startedAt` parsed as a
   date, falling back to the directory's mtime when absent/invalid. Keep the first
   `keepRuns`. Additionally always keep: active runs (`isActiveRun`) and the run
   that `runs/latest` points to (`readlink` basename; missing link = none). Remove
   the rest.
2. If **any** run in the project is active: do not touch `baselines/` or `work/`;
   set `skipped = 'a run is in progress; baselines and work folders were left alone'`.
   Otherwise `skipped = null` and apply rules 3–4.
3. **Baselines** — each directory entry in `baselines/`. An entry without a
   `side.json` file is removed. The others are ordered newest first by
   `side.json` mtime; keep the first `keepBaselines`; remove the rest.
4. **Work** — every entry in `work/` is removed, except entries whose name starts
   with `record-` and whose mtime is within 24 hours of `now`
   (a `spotter record` may be in progress; it has no activity file).
5. Removal is `rm(path, { recursive: true, force: true })`, skipped when `dryRun`.
   `removed` lists the same paths either way.


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
Write `docs/plans/artifact-retention-progress/coder-prune.md`: files changed, what each change
does, verification commands with exact output counts, anything unverified, and
`## ESCALATIONS` (or `## ESCALATIONS\nNone.`). Do not write any other progress file.

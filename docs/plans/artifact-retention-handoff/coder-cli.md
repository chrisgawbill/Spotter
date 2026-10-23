# Brief: coder-cli

Repo: /home/chris_dev/projects/Spotter

## Your files (only these)
- `src/cli.mjs`
- `bin/spotter`
- `README.md`
- `docs/self-hosting.md`
- `examples/deploy/spotter-dashboard.service`

Do not edit anything else. coder-prune is concurrently creating `src/prune.mjs`
and `test/prune.test.mjs`. Import from `./prune.mjs` exactly these names:
`retentionSettings`, `pruneProject` (signatures below). The file may not exist
yet while you work; do not create or stub it. If you need it to exist to test,
say so in your report rather than writing it.

## Task
1. `src/cli.mjs`
   - Add `prune` to `USAGE`, worded like the others:
     `spotter prune [<project>] [--dry-run] [--keep-runs <n>] [--keep-baselines <n>]`
     with a 2–3 line description (deletes older runs, unused baseline cache
     entries and leftover work folders; keeps in-progress runs and runs/latest;
     defaults from SPOTTER_KEEP_RUNS / SPOTTER_KEEP_BASELINES, else 10 and 5).
   - `parseArguments` (`src/cli.mjs:42`): project is positional only when argv[1]
     does not start with `--`; add `--dry-run`, `--keep-runs`, `--keep-baselines`.
     Existing behavior for run/record/dashboard/list must be unchanged.
   - `runCommandLine` (`src/cli.mjs:63`): handle `prune` before the
     run/record check. Projects = `[options.project]` (validated against
     `listProjectNames()`, else throw `Unknown project "<name>"`) or all
     `listProjectNames()`. For each: `pruneProject(projectDirs(name), { ...retentionSettings(process.env, { keepRuns: options.keepRuns, keepBaselines: options.keepBaselines }), dryRun: options.dryRun })`.
     Print with `console.log` per the contract, paths through `toHostPath`. Return `EXIT_PASS`.
   - `runProject` (`src/cli.mjs:89`): automatic cleanup after
     `activity.finish(exitCode ? 'fail' : 'pass')` (line 154) and before
     `return exitCode`, per the contract. It must never throw out of runProject or
     change the exit code; wrap all of it (including `retentionSettings()`) in try/catch.
   - `loadOrRunBase` cache hit (`src/cli.mjs:167`): refresh `cacheFile` mtime with
     `utimes` per the contract (import from `node:fs/promises`).
2. `bin/spotter`: forward `-e SPOTTER_KEEP_RUNS -e SPOTTER_KEEP_BASELINES -e SPOTTER_AUTO_PRUNE`
   in the final `docker run` (name only, no values; next to the other `-e` lines).
3. `README.md`: add `bin/spotter prune my-app --dry-run` to the top command block with
   a short comment; add a short `## Disk usage` section (before `## Severity and exit codes`)
   explaining automatic cleanup after each successful run, the three env variables and
   defaults, what is always kept, and `spotter prune` with its flags. Keep it under ~12 lines,
   README tone (terse, factual).
4. `docs/self-hosting.md`: one or two sentences where env vars are discussed (near line 40)
   saying retention is set with those variables on the dashboard service, pointing to the
   README section.
5. `examples/deploy/spotter-dashboard.service`: add commented examples
   `#Environment=SPOTTER_KEEP_RUNS=10`, `#Environment=SPOTTER_KEEP_BASELINES=5`,
   `#Environment=SPOTTER_AUTO_PRUNE=on` after the SPOTTER_HOME line.

## Keep
- The existing `rm(workRoot)` at `src/cli.mjs:121` and record cleanup at line 214.
- `pointLatestAt` must run before cleanup so the newest run is the `latest` target.
- Exit codes 0/1/2 semantics.

## Verify
- `node --check src/cli.mjs` and `bash -n bin/spotter`.
- `npm test` once `src/prune.mjs` exists (baseline 41/41 before your change; other
  agent adds a test file). If `src/prune.mjs` is not there yet, run only
  `node --check` and say so.
- Quick parse check: `node -e "import('./src/cli.mjs').then(m=>console.log(m.parseArguments(['prune','--dry-run','--keep-runs','3'])))"`.
  (cli.mjs imports prune.mjs at top level, so this needs that file too.)

## Contract (pasted from docs/plans/artifact-retention-contracts.md)
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

## `src/cli.mjs` usage of the contract

- Command: `spotter prune [<project>] [--dry-run] [--keep-runs <n>] [--keep-baselines <n>]`.
- `parseArguments`: project is positional only when the second argv item does not
  start with `--`. New flags: `--dry-run` -> `options.dryRun = true`,
  `--keep-runs` -> `options.keepRuns = flags[++index]`,
  `--keep-baselines` -> `options.keepBaselines = flags[++index]`.
- Prune output line per path: `would remove <hostPath>` (dry run) or `removed <hostPath>`;
  per project with a non-null `skipped`: `<project>: <skipped>`; final line
  `<n> item(s) would be removed.` / `<n> item(s) removed.` Exit 0.
- Unknown project name (not in `listProjectNames()`) -> throw `Unknown project "<name>"` (exit 2 via existing handler).
- After a successful `runProject` (after `activity.finish(...)`, before `return exitCode`):
  call `retentionSettings()`; when `autoPrune` is false do nothing; otherwise prune that project with it; on success log `pruned <n> old item(s)` only when n > 0;
  on any error log `retention skipped: <message>`; never change the exit code.
- Baseline cache hit in `loadOrRunBase`: `await utimes(cacheFile, new Date(), new Date()).catch(() => {})` before returning.

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
Write `docs/plans/artifact-retention-progress/coder-cli.md`: files changed, what each change
does, verification commands with exact output counts, anything unverified, and
`## ESCALATIONS` (or `## ESCALATIONS\nNone.`). Do not write any other progress file.

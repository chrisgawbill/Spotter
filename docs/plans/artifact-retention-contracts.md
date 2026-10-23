# Artifact retention contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

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

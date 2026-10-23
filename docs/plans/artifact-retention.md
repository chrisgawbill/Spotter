# Artifact retention (QA-20 subset)

Scope approved by the user on 2026-10-23: items 1–3 only — prune old runs, prune
stale baseline cache entries, clear orphaned work folders. Retention counts must
be user-settable. Cancellation, cache locking and visual-evidence shrinking are
out of scope. QA-20 stays IDEA in the ticket index; acceptance is the Product
Owner's.

## Findings (verified against the tree)

- Disk use: `~/spotter` 7.4 GB; `hockeystats-webapp/runs` 6.0 GB (50 runs, ~300 MB
  each recent), `baselines` 1.3 GB (21 entries ~70 MB, mostly one base commit),
  `work` 88 MB from 3 interrupted runs. Nothing is ever deleted except a run's own
  work folder (`src/cli.mjs:121`) and record exports (`src/cli.mjs:214`).
- Runs never read baseline files after finishing: `compareScreenshots` copies
  before-images into `runs/<id>/visual/before/` (`src/visual.mjs:34`). Deleting a
  baseline entry only costs a recompute.
- A run in progress writes into `baselines/<key>/` before `side.json` exists
  (`src/cli.mjs:172-182`) and reads the cached base screenshots at the end
  (`src/cli.mjs:137`). So baselines and work must not be pruned while any run in
  that project is active.
- Active run = `activity.json` `status: 'running'` with `updatedAt` within 30 s;
  heartbeat is 5 s (`src/activity.mjs:15`), dashboard uses the same 30 s rule
  (`src/dashboard.mjs:39`). Dashboard-launched runs use UUID ids, CLI runs use
  timestamp names, so order by `startedAt`, not by name.
- `runs/latest` is a relative symlink to the newest finished run
  (`src/cli.mjs:238-242`); Jenkins copies it.
- `bin/spotter` only passes named env vars into Docker; the dashboard spawns runs
  inside its own container, inheriting its env.
- Adding `src/prune.mjs` changes `spotterCodeHash()`, so existing baseline entries
  become unusable once; the first prune clears them.

## Design

- New `src/prune.mjs` with `retentionSettings`, `isActiveRun`, `pruneProject`
  (frozen in `artifact-retention-contracts.md`).
- `spotter prune [<project>] [--dry-run] [--keep-runs N] [--keep-baselines N]`;
  no project = every configured project.
- Automatic cleanup: unless `SPOTTER_AUTO_PRUNE=off`, every successful `spotter run` prunes its own project afterwards with the env
  settings; a prune failure is logged and never changes the run's exit code.
- Settings: flags > `SPOTTER_KEEP_RUNS` / `SPOTTER_KEEP_BASELINES` > defaults
  (10 runs, 5 baselines). `bin/spotter` forwards all three variables.
- On a baseline cache hit, refresh `side.json` mtime so retention is LRU.

## Ownership

| Agent | Files |
| --- | --- |
| coder-prune | `src/prune.mjs` (new), `test/prune.test.mjs` (new) |
| coder-cli | `src/cli.mjs`, `bin/spotter`, `README.md`, `docs/self-hosting.md`, `examples/deploy/spotter-dashboard.service` |

One wave, parallel: coder-cli codes against the frozen contract.

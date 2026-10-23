# Artifact retention — coordinator status

Wave 1 (parallel): coder-prune and coder-cli both complete; ownership boundary held.

## Coordinator interventions
- Added the `SPOTTER_AUTO_PRUNE=off` note to the `spotter help` text (`src/cli.mjs`).

## Verified
- `npm test`: 46 tests, 46 pass (baseline 41 + 5 in `test/prune.test.mjs`).
- `bash -n bin/spotter` ok.
- `bin/spotter prune --dry-run` against the real data in Docker: exit 0; 58 items
  (5.6 GB) would be removed — hockeystats-webapp 39 runs, 16 baselines,
  3 work folders; the other projects are under the limits. The 10 newest runs are
  kept and `runs/latest` is among them. Nothing was deleted.

## Not verified
- A real `spotter run` with automatic cleanup. AGENTS.md's real checks would delete
  ~5.6 GB on completion, so they were not run without the user's go-ahead.
  Steps: `bin/spotter run hockeystats-webapp --ref main`, then confirm the stderr line
  `pruned <n> old item(s)`, that `runs/latest` resolves, and that 10 runs remain.
- Concurrent run + prune timing in a live dashboard.

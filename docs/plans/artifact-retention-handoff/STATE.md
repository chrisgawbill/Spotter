# Artifact retention — STATE (wave 1)

## Landed and verified
- Nothing yet. Plan and frozen contracts written by the coordinator.

## Baseline
- Host Node v18.19.1. `npm test` (= `node --test test/*.test.mjs`): 41 tests, 41 pass, 0 fail.
- No linter or typecheck is configured in this repo. Plain ESM `.mjs`, Node stdlib only.

## Frozen decisions
- Defaults: keep 10 runs, 5 baselines per project. Auto cleanup on by default.
- Settings precedence: CLI flags > env (`SPOTTER_KEEP_RUNS`, `SPOTTER_KEEP_BASELINES`) > defaults. `SPOTTER_AUTO_PRUNE` (on/off) is env only.
- Active run = activity.json status 'running' and updatedAt within 30 s (same rule as `src/dashboard.mjs:39`).
- Never delete: active runs, the `runs/latest` target. Never touch baselines/work while any run in that project is active.
- Old runs do not depend on baselines (before-images are copied into the run by `src/visual.mjs:34`).
- No new dependencies. No project-specific behavior in `src/`. Do not edit `docs/ticket-index.md` (QA-20 acceptance belongs to the Product Owner).
- Do not mention AI tools in code, comments or docs.

## Known patterns
- Comments are sparse: one-line `/** ... */` JSDoc on exported functions, as in `src/git.mjs` and `src/activity.mjs`.
- Tests use `node:test` + `node:assert/strict`, temp dirs via `mkdtemp(path.join(tmpdir(), 'spotter-...'))` (see `test/dashboard.test.mjs`).
- `src/paths.mjs` computes `spotterHome` from env at import; `pruneProject` takes `directories` so tests need no env.

## In flight (wave 1, parallel)
- coder-prune: `src/prune.mjs`, `test/prune.test.mjs`.
- coder-cli: `src/cli.mjs`, `bin/spotter`, `README.md`, `docs/self-hosting.md`, `examples/deploy/spotter-dashboard.service`.

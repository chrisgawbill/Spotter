# surface (wave 2) report

## Changes
- src/cli.mjs: imports LEVELS/resolvePlan/summarizePlan; USAGE; `--level` parsing (exact C4 message); `--level applies to run only` (before config load) and `--level cannot be combined with --live-auth`; runProject resolves plan first, logs `plan:`, `runSkip` (options.skip + plan.skip) and `plan.config` for both sides, `assessBaseline`/`assessCompleteness` get `plan.config` + `options.skip` + `level: plan.record`; activity metadata `level`/`plan`; `run.plan`; cache key gets `-${planHash}`.
- src/report.mjs: `- plan:` line before `- coverage:`.
- src/htmlReport.mjs: "Not available at level high: …" paragraph after the coverage summary.
- src/dashboard.mjs: `readRun.plan`; `GET /api/plan`; `levels` on `/api/projects`; POST `level` validated (string, then resolvePlan) before the busy check; `--level` appended only when sent; `metadata.level`.
- src/dashboard/index.html: `#level` select, `#plan` (role=status), `#run-plan`.
- src/dashboard/dashboard.js: default option label, Low disabled without levels.low, `updatePlan()` (deduped by project+level so the 2s poll does not refetch; error text in `#plan` and `#submit` disabled), level sent only when non-empty, `#run-plan` on activity page. Chosen level survives refresh (select is never rebuilt).
- Tests: test/cli.test.mjs (new, 2), test/dashboard.test.mjs (+1 test, +1 assertion for 400 on no-levels mock), test/report.test.mjs (+1), integration/dashboard.test.mjs (#level options, `#plan` starts `Plan: no level`).

## Test results
- Plain `npm test` on this host (Node 18.19.1): 86 tests, 85 pass, 1 fail. The failure is test/cli.test.mjs: importing cli.mjs pulls in `playwright`, which aborts on Node < 20. Environment limit, not a logic failure.
- With `playwright` stubbed via a loader (scratchpad only, no repo change): 87 tests, 87 pass (83 + 2 cli + 1 dashboard + 1 report).
- Manual (stubbed playwright): `run demo --level bogus` -> `spotter: Unknown level "bogus"; use low, medium or high`, exit 2; `record x --level low` -> `--level applies to run only`, exit 2.

## Not verified
- Docker browser integration not run (coordinator). Browser layout of the new Level select / plan line not inspected; no CSS change made (form uses `ds-cluster`/`ds-field`, so it should wrap).
- `--level` with `--live-auth` rejection and the real run path (plan, cache key) were not executed end to end.

## Discrepancies
- test/cli.test.mjs cannot load on Node 18 (see above); passes on Node 20+.
- Live-auth rejection sits inside the existing `if (options.liveAuth)` block, so project config loads first.

## ESCALATIONS
None.

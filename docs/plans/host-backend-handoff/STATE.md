# QA-27 host-started recording backend — STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- Plan `docs/plans/host-backend.md`, contracts `docs/plans/host-backend-contracts.md` (C1–C5), frozen.
- QA-22–QA-26 are on this branch's base (`same-origin-api-fixtures`): `web.api.paths/headers/backend`,
  `src/backend.mjs` (`startBackend`), proxy inference in `route-discovery.mjs`/`project-options.mjs`.

## Baseline (branch host-recording-backend @ e1a68b3, before any coder change)
- `npm test` on host Node 18.19.1: **112 tests, 112 pass, 0 fail**.
- Docker browser integration: 12/12 pass (coordinator runs it; you do not).
- No typecheck or lint in this repo (plain ESM JavaScript, Node test runner).

## Frozen decisions
- Opt-in is the `--host-backend` command-line flag only; no YAML field enables host execution.
- `bin/spotter record … --host-backend` execs `node src/host-record.mjs`; it starts the backend from a
  `git archive` export at `<work>/record-host-<sha12>`, then runs `bin/spotter record … --backend-running`.
- `--backend-running` (internal) makes the container record skip `startBackend`.
- `web.api.backend.stop` runs inside `startBackend().stop()` after the group is killed, on every exit path.
- Detection lives in new `src/backend-discovery.mjs`; proposes a backend only when exactly one candidate
  serves the inferred `recordFrom`. Compose commands use `-p spotter-<name>` and `down -v`.

## Repo patterns
- ESM `.mjs`, two-space indent, single quotes, terse `/** … */` JSDoc above exports, dense one-line logic.
- Tests: `node:test` + `node:assert/strict`, one `test('plain sentence', …)` per behaviour, temp dirs via `mkdtemp`.
- **Host Node is 18**: a unit test must never import a module that imports `playwright`
  (`src/cli.mjs`, `src/stages/*.mjs`). New host modules must not import them either.
- Nothing project-specific in `src/` (triple-crown is only the motivating example; never name it in src or tests).
- Do not mention AI tools in code, comments or messages. Do not commit.

## In flight (wave 1, parallel; each agent owns its files exclusively)
- host: src/config.mjs, src/config-fields.mjs, src/backend.mjs, src/cli.mjs, src/host-record.mjs (new), bin/spotter,
  test/config.test.mjs, test/backend.test.mjs, test/host-record.test.mjs (new)
- setup: src/backend-discovery.mjs (new), src/project-setup.mjs, test/backend-discovery.test.mjs (new), test/project-setup.test.mjs
- Coordinator: README, docs, examples, plans, verification.

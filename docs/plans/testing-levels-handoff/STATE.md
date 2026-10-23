# QA-08 testing levels — STATE (coordinator-owned, overwritten each wave)

## Landed and verified
- engine (wave 1): `src/levels.mjs` (C1), config wiring (C2), completeness `level` (C3). Coordinator re-ran tests.
- Coordinator fix: completeness drops a listItems item only when an exclusion matches name AND kind
  (a route named like a check/stage must not hide it). Contract C3 updated.
- `UNSUPPORTED_AT_HIGH` and `record.exclusions` are shared references: treat as read-only.

## Baseline
- main @ 5a9aa22: `npm test` 71/71. After wave 1: **83 tests, 83 pass, 0 fail**.
- Dashboard integration (Docker) on main: 1/1 pass.
- No typecheck or lint in this repo (plain ESM JavaScript, Node test runner).
- Browser integration runs in Docker (`spotter:latest` exists); coordinator runs it.

## Frozen decisions
- Contracts: `docs/plans/testing-levels-contracts.md` (C1–C7). Do not redesign.
- low = only `coverage.required` checks; rules excluded unless `rules` is required; smoke routes from `levels.low.routes` at first viewport + first scheme, all sessions, no fault visits; specs only if required or narrowed by `levels.low.specs.grep`.
- high = medium plan + `UNSUPPORTED_AT_HIGH` listed; nothing enabled.
- No level and no default → config unchanged, `completeness.level` null (existing behaviour preserved).
- Unknown level, or low without `levels.low` → error before the run starts.
- Both sides run with the plan config; the plan hash is part of the baseline cache key.

## Repo patterns
- ESM `.mjs`, two-space indent, single quotes, terse JSDoc `/** … */` one-liners above exports.
- Tests: `node:test` + `node:assert/strict`, one `test('plain sentence', …)` per behaviour.
- Nothing project-specific in `src/`. Do not mention AI tools in code or comments.
- Dashboard: no new dependencies; reuse `ds-*` classes from `@chrisgawbill/aero-md3-core`.

## In flight
- surface (wave 2): CLI, reports, dashboard server/page and their tests (see surface.md).
- Coordinator owns README/docs (already updated) and engine files (now frozen).

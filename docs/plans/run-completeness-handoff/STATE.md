# Run completeness (QA-09) — STATE (coordinator-owned, overwritten per wave)

## Landed and verified
- engine: `src/completeness.mjs` (C4–C7), `coverage` + `expectSelector` config (C1). Diff reviewed.
- stages: web summary `pagesFailed`/`faultVisitsFailed`/`sessionChecks` (C2); specs `specSummary` with `selected`/`flaky`/`completed` (C3). Diff reviewed.
- Coordinator: README, docs/browser-checks.md, docs/project-specs.md, docs/dashboard.md, docs/pipeline.md, examples/deploy/Jenkinsfile (exit 3).

## Verification baseline (before any QA-09 change)
- Before QA-09: `npm test` 52/52.
- After wave 1 (coordinator re-run): `npm test` 68/68; Docker `integration/specs.test.mjs` 3/3; `integration/browser-depth.test.mjs` 2/2; `integration/dashboard.test.mjs` not yet run in this effort.
- Host Node 18 runs unit tests only. Browser integrations need Docker image
  `spotter:latest` (present). Command pattern:
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/<file>.test.mjs`
- No linter or typecheck is configured; `node --check <file>` is the syntax check.

## Frozen decisions
- Contracts: `docs/plans/run-completeness-contracts.md` (C1–C8). Do not change them.
- Completeness uses head stage summaries only; never baseline comparison.
- Exit 3 = incomplete; precedence 2 > 3 > 1 > 0.
- Session assertions never create findings; they only feed completeness.
- `completeness.level` is always null (QA-08 not implemented).
- Fixture age is recorded, never judged.

## Repo rules
- Nothing in `src/` may be project-specific. Do not mention AI tools anywhere.
- `createFinding` keys must stay stable; do not change existing finding keys/titles.
- Match the surrounding terse style: ES modules, 2-space indent, single quotes,
  one-line JSDoc comments, no new dependencies.

## In flight
- Nothing. All waves landed and verified; see progress/coordinator.md.

# engine report (wave 1)

## Changed
- `src/levels.mjs` (new): LEVELS, UNSUPPORTED_AT_HIGH, levelProblems, normalizeLevels, resolvePlan (+ private narrowToLow), summarizePlan per C1.
- `src/config.mjs`: import; `problems.push(...levelProblems(config))` before the throw; `levels: normalizeLevels(config.levels)` in the returned object.
- `src/config-fields.mjs`: `levels` entry after `coverage` (C2 text).
- `src/completeness.mjs`: `assessCompleteness` takes `level = null`, drops listItems items matching exclusion names, appends `status: 'excluded'` items, returns `level`; `summarizeCompleteness` takes `level`, adds `level <name>` after the status word and `<n> excluded by level` after the skipped part.
- Tests: `test/levels.test.mjs` (new, 9), `test/config.test.mjs` (+1), `test/completeness.test.mjs` (+1).

## Results
`npm test`: 82 tests, 82 pass, 0 fail (baseline 71).

## Notes
- `summarizeCompleteness` reads `level` from its argument (the completeness record), so callers passing the record from `assessCompleteness` need no change.
- `resolvePlan` returns `record: null` when no level; `exclusions`/`unsupported` arrays on the record are shared references (`UNSUPPORTED_AT_HIGH` itself at high); treat as read-only.
- No contradictions with the brief found.

## ESCALATIONS
None.

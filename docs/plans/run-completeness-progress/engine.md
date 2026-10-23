# engine report (QA-09)

## Changed
- `src/completeness.mjs` (new): requirableNames, describeFixtures, assessBaseline, assessCompleteness, summarizeCompleteness; shared internal `listItems`.
- `src/config.mjs`: `coverage` validation/normalization (`{ required: [], minSpecs: null }` defaults), session `expectSelector` check in `validSession` (existing sessions message unchanged), imports `requirableNames`.
- `src/config-fields.mjs`: `coverage` entry; `web.sessions` example/help mention `expectSelector`.
- Tests: `test/completeness.test.mjs` (12), `test/config.test.mjs` (+3). Result: 17/17 pass (`node --test test/completeness.test.mjs test/config.test.mjs`). Full suite not run.

## Notes
- Fault-visit counts: `executed = faultVisits - (faultVisitsFailed ?? 0)`.
- Specs counts come from `stages.web.specs` whenever present (even in live mode); pages/faultVisits counts are null in live mode.
- `minSpecs` validation also rejects non-safe-integers.

## Required caller changes
None.

## ESCALATIONS
None.

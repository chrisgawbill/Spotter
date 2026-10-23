# coverage report (C4)

- src/completeness.mjs: added the `API traffic not replayed` gap in `assessCompleteness`, verbatim from C4, between the page-visit and fault-visit gaps.
- test/completeness.test.mjs: 4 tests (one endpoint, five endpoints, empty/missing/'skipped'/undefined web, no web.api configured).
- test/report.test.mjs: 1 test (INCOMPLETE, `## Incomplete coverage (1)`, gap line).
- Verified: `node --test test/completeness.test.mjs test/report.test.mjs` 27/27 pass. Full suite not run (per brief).

## ESCALATIONS
None.

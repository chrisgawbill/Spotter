# surface report (C8)

## Changes
- src/cli.mjs: usage text, EXIT_INCOMPLETE=3, base promise never rejects (logs `base: failed — msg`, activity event, returns `{ error }`), `loadOrRunBase` returns `{ side, cached }`, `assessBaseline`, failed baseline => all head findings new, `run.fixtures = describeFixtures`, `run.completeness`, exit precedence 2 > 3 > 1 > 0, `activity.finish('incomplete')`.
- src/report.mjs: RESULT INCOMPLETE > FAIL > PASS, `## Incomplete coverage (n)` section (after header, before New), `- coverage:` last Checks line; no change without `completeness`.
- src/htmlReport.mjs: Coverage section (summary, gaps, items table), escaped.
- src/dashboard.mjs: readRun status `incomplete`, `coverage`, `gaps`.
- dashboard.js/index.html: `incomplete` badge (warning, ◐), `#coverage` in `.run-meta`, `#coverage-gaps` after `#run-error`. No CSS change.
- Tests: test/report.test.mjs (+3), test/dashboard.test.mjs (incomplete/complete seeded runs; run count 3->5), integration/dashboard.test.mjs (seeded incomplete run: badge, #coverage, gap item).

## Verification
- node --check on all edited JS: ok. `npm test`: 71/71.
- Docker integration/dashboard.test.mjs: 1/1 pass.
- Not run: real CLI runs (exit codes 3/1/0, base-failure path, activity 'incomplete' in real runs), visual inspection of the new coverage lines/list.

## Notes
- activity.mjs not read; `activity.finish('incomplete')` assumed to accept any status string (not verified).
- Dashboard runs list/project cards reuse `badge`, so INCOMPLETE shows there too.

## Required caller changes
None.

## ESCALATIONS
None.

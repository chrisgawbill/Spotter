# stages report

## Changes
- src/stages/web.mjs: visitPage returns `where` and `sessionCheck` (true/false/null); healthy sweep visits of sessions with `expectSelector` count the locator after settle; a thrown navigation counts as failed. runWebStage adds `pagesFailed`, `faultVisitsFailed` (findings with check `navigation` / `fault-navigation`) and `sessionChecks` ({} when none; examples = first 3 `where`). No findings, keys or severities changed; record mode untouched.
- src/stages/specs.mjs: new exported `specSummary(report, runnerFailed, failed, live)` adds `flaky`, `selected`, `completed`; `runnerFailed` = exitCode != 0 with no spec findings.
- Tests: test/specs.test.mjs (specSummary unit test), integration/specs.test.mjs (selected/flaky/completed asserts + grep-matches-nothing test), integration/browser-depth.test.mjs (member expectSelector h1, ghost session with absent selector; pages 3, faultVisits 6, pagesFailed/faultVisitsFailed 0, ghost failed===checked with examples, no ghost non-low finding).

## Results
- node --check web/specs: ok. node --test test/specs.test.mjs: 2/2 pass.
- Docker integration/specs.test.mjs: baseline 2/2; after 3/3 pass.
- Docker integration/browser-depth.test.mjs: baseline 2/2; after 2/2 pass (first run failed on my wrong faultVisits count 8; correct is 6; fixed).
- Full npm test not run (per brief).

## Required caller changes
None. (The browser-depth test passes `expectSelector` straight through normalizeConfig; it worked, so engine's config accepts it or passes it through. Re-check after engine lands.)

## ESCALATIONS
None.

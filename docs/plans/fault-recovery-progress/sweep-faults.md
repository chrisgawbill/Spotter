# sweep-faults report (QA-11, wave 2)

## Files changed
- `src/levels.mjs`: `FAULT_KINDS`, `DEFAULT_FAULT_KINDS`; high plan sets `faultInjection.kinds` when fault injection is configured; `summarizePlan` appends ` (<kinds>)` only when kinds are set and differ from the default (small private `faultKindsNote`).
- `src/config.mjs`: kinds validation (exact C5 message), `String` normalization only when kinds is an array; no default added.
- `src/config-fields.mjs`: `web.faultInjection` example/help and `levels` help per C5.
- `src/fixtures.mjs`: abort, 401, 403, 429 (+ `retry-after: 1`), malformed in the existing fault branch (500 and delay unchanged in behaviour).
- `src/stages/web.mjs`: fault loop uses `web.faultInjection.kinds ?? DEFAULT_FAULT_KINDS` (import from levels.mjs). Judging untouched.
- `test/levels.test.mjs`, `test/config.test.mjs`, `integration/browser-depth.test.mjs`: C8 tests.

## Results
- `npm test` host: 162/162 (baseline 160; +2 new tests).
- Docker browser-depth: 4/4, run twice (both pass). same-origin-api 2/2, browser-matrix 4/4, recovery 4/4.

## Empirical points
- Healthy app with `.catch(showError)`: all 7 kinds (including abort) produced no finding above low and no api-error/unrecorded-request. `faultVisits === 7`, `faultVisitsFailed === 0` (1 route x 1 session x 1 endpoint x 7).
- Unguarded app (`r.json().then(render)`, no catch): new `fault-crash` for `page crashes during abort response` and `... malformed response` against the healthy run.

## Deviations
- Existing test `high is medium plus the browser matrix...` in `test/levels.test.mjs` needed `faultInjection: config.web.faultInjection` added to its comparison override, since high now adds `kinds` (the default web config has fault injection on). Assertions otherwise unchanged.
- The seeded app in the new integration test does not blank the page itself; the unhandled rejection (uncaught error) is enough for `fault-crash`. Brief said "blanking the page"; the assertions required (abort/malformed crash titles) hold.
- Firefox/WebKit fault behaviour unverified (faults run in the first browser only).

## Required caller changes
None required. Docs/dashboard text may mention that the plan summary shows ` + fault visits (<kinds>)` at high or with configured kinds.

## ESCALATIONS
None.

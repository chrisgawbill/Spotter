# engine report

C2–C5 implemented in src/config.mjs, src/levels.mjs, src/completeness.mjs, src/config-fields.mjs with tests in test/config|levels|completeness.test.mjs. No playwright imports.

`npm test` on host: 156 pass, 0 fail (baseline 149 + 7 new).

Notes
- Raw `levels` shape message is now "`levels` must be an object with optional default, low and high" (was "default and low"); existing config test updated. Not in the contract.
- test/completeness.test.mjs hand-built web fixture gained `browsers: ['chromium'], devices: []` because countPageVisits needs normalized arrays.
- High with levels.high but invalid matrix is rejected only at config normalization; `levels.high` requires raw `web` (checked on the raw config).
- Normalized `levels` now always includes `high` (null when absent), so any consumer deep-comparing levels sees a new key.
- Low exclusion order: route, viewport and scheme exclusions, then `fault visits`, then dropped browsers, then devices (before any specs/minSpecs exclusion).

## Required caller changes
None.

## ESCALATIONS
1. Changed the raw `levels` shape message wording (see Notes) to mention high; the contract only fixed the `levels.high` message. Low confidence it is wanted; revert is a one-line change in src/levels.mjs plus test/config.test.mjs.

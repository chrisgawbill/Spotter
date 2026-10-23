# coder-server report

## Files changed
- src/dashboard.mjs: imports from ./prune.mjs; new option `env = process.env`; `projectFolders(name)` helper; GET /api/storage, PUT /api/retention, POST /api/cleanup added before the generic 405 (same-origin check, 4096-byte body loop, 409 while `starting`, errors flow to the existing catch as 400).
- test/dashboard.test.mjs: new test 'storage API reports usage, saves retention settings and cleans up old runs' (also imports readdir).

## Verification
- `node --check src/dashboard.mjs`: ok.
- `node --test test/dashboard.test.mjs`: 6 tests, 6 pass, 0 fail (against coder-core's prune.mjs as it stood at run time).
- Full suite not run. Unverified: 409-while-starting path for /api/cleanup (no test), 413 for new routes.

## ESCALATIONS
None.

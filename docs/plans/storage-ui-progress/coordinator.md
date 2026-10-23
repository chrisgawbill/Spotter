# Storage page — coordinator status

Wave 1 (parallel): coder-core, coder-server, coder-ui complete; ownership boundary held.

## Verified
- `npm test`: 52 tests, 52 pass.
- Docker `integration/dashboard.test.mjs`: 1 test, pass (includes Storage nav, keyboard reach, unsaved-change guard, save).
- Screenshots (fake data): before/after desktop + 375 px mobile, env-locked variant; no horizontal page overflow.

## Found during user verification
- The live `spotter-dashboard` container predates the server change: `/api/storage` 404 and
  `PUT /api/retention` 405 until the dashboard process restarts. Not restarted without user approval.

## Known limitations
- Saving sends env-locked fields' effective values into retention.json (env still wins).
- A hand-edited invalid retention.json makes the Storage page and `spotter prune` error until fixed.
- Long project names wrap mid-word in the mobile table (same as the runs table).

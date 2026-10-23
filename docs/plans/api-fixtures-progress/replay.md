# replay report (C1, C2, C3, QA-26 detection)

## Changes
- `src/config.mjs`: `apiProblems` (C1 messages 1-7, module-private ENV_NAME/HEADER_NAME/API_PATH/`validHeaders`), session `apiHeaders` check (8) in the valid-sessions branch, normalized `web.api` with defaults (`envVar: null`, `recordFrom: null`, `headers: {}`, `paths: []`, `backend: null | {timeoutMs: 60000, ...}`). `validSession` unchanged (ignores `apiHeaders`).
- `src/config-fields.mjs`: `web.api` entry exactly as contracted.
- `src/fixtures.mjs`: `matchesApiPath`, `apiRequestMatcher`, `recordingHeaders`; both handlers use `context.route(apiRequestMatcher(...))`; record URL from pathname+search; `route.fetch` gets `headers` only when non-empty; utf8 entries stored via `redactSecrets`. No Playwright import.
- `src/stages/web.mjs`: env only with `envVar`; `apiPaths` and `recordingHeaders(web.api, session)` passed from `visitPage`; `watchPageProblems` uses the matcher (`isApi`) and the QA-26 check (before the status early return) with an `onNotReplayed` callback; `visitPage` emits `api-not-replayed` once per endpoint per healthy sweep visit and returns `apiNotReplayed`; summary gains sorted `apiNotReplayed`; `apiErrorProblem(response)` titles from pathname+search.
- `src/stages/specsFixture.mjs`: passes `apiPaths: settings.web.api.paths ?? []`.
- Tests: `test/config.test.mjs` (3 new), `test/fixtures.test.mjs` (new, 5), `integration/same-origin-api.test.mjs` (new, 2).

## Verification
- `node --test test/config.test.mjs test/fixtures.test.mjs`: 14 pass, 0 fail.
- Docker (`same-origin-api`, `browser-depth`, `specs`, `contracts`): 8 tests, 8 pass, 0 fail.
- Not run: full `npm test` (per brief). Fake-origin byte-identical behaviour is covered only by the existing integration files passing; HockeyStatsWebApp baselines not run.

## Notes
- `recordingHeaders` throws before any request if a `${VAR}` is unset/empty, from `visitPage` in record mode (so the throw happens per visit context creation).
- `api-not-replayed` finding fires only for `mode === 'sweep'` and non-fault visits; summary list comes from healthy visits only.
- Test app guards the 500 fault response (`(d.items || [])`), otherwise the fault visit rightly reports `fault-crash`.

## Required caller changes
None.

## ESCALATIONS
None.

# Ticket evidence

Historical verification snapshots, recorded on 2026-10-22. Counts, service state
and local artifact paths describe those checks; they are not current guarantees.
See [ticket scope and status](ticket-index.md).


## QA-01

Verify results: 14 unit tests pass; `main`
against itself gives 6 issues, all confirmed real (see "Found on main");
the seeded branch reported each of its 5 defects as new and nothing else
besides Prettier on the edited file (~45s per run; base results cached).

**Found on main (2026-10-22):**

- Matchup page at 768px: Team DNA "Shot Suppression" value runs past the card
  and 18px off screen (cut off by `body { overflow-x: clip }`).
- Live API: `GET /player/goalie/statLeaders/shutouts` answers 500.
- Cross-feature imports missing from architecture.md's list:
  draft-lottery → standings, favorite-players → teams, standings → schedule,
  teams → standings; `* → season` is allowlisted pending confirmation.

**Learned while building:** the app clips sideways overflow on `body`, so the
check reports content cut off at the right edge rather than page scroll; its
theme follows time of day, so the config seeds the saved theme per scheme.


## QA-02

**Evidence (2026-10-22):**

- `npm test` passes; 17 unit/browser tests pass in the Docker image. The browser
  regression covers isolated session recording/replay and seeded accessibility,
  keyboard, crash, blank-page and loading failures against a healthy baseline.
- Full main run: 66 page variants and 308 endpoint-fault visits. Existing API,
  layout, boundary and accessibility findings remain; keyboard focus checks are
  advisory. Signed-in HockeyStats visits need a configured test session.
- Seeded branch: all six intended defects are new (type, test, import, overflow,
  unnamed button, unreachable button), plus the seeded content's landmark
  violation: seven groups total, zero fixed, no unrelated new findings.
  Sample: `~/spotter/hockeystats-webapp/runs/20261022-053311-verify-browser-depth-defects/report.md`.
- Real-run timing/status false positives led to project config corrections:
  wait for retries, including four delayed attempts; match actual spinners,
  excluding valid empty-state status regions. Focused recheck: three affected
  routes, 78 endpoint-fault visits, zero unexpected fault/navigation findings.
  Evidence: `/tmp/spotter-depth-recheck/output/result.json`.


## QA-04

**QA-04 evidence (2026-10-22):**

- `npm test` passes all eight test files. Docker integrations for specs and
  contract recording pass. Three real CLI recordings establish the initial
  snapshot, detect anonymous/member shape drift, and ignore value-only changes.
- Isolated HockeyStatsWebApp clone: healthy named spec passes with recorded
  response/status and fixed browser time; its seeded failure is the only new
  issue against the healthy baseline (three existing API findings remain).
- Full main: 66 page variants and 308 fault visits; existing app findings plus
  four transient external-image network failures. Full seeded comparison:
  all six intended defects are new, plus their content's landmark violation;
  seven groups, 17 existing, zero fixed, no unrelated new findings. Sample
  report accepted by Product Owner 2026-10-22.
- Full regression: `~/spotter/hockeystats-webapp/runs/20261022-150821-HEAD/report.md`.
- Named-spec sample: `/tmp/spotter-qa04-data/hockeystats-webapp/runs/20261022-151134-verify-project-spec-defect/report.md`.


## QA-06

**QA-06 implementation (2026-10-22):**

- `spotter dashboard` serves the project/branch launcher, recent runs, live
  activity and embedded reports using the shared Aero stylesheet. Activity
  events cover head/base work, static checks, builds, browser variants and
  endpoint fault scenarios; a five-second heartbeat identifies interrupted runs.
- Unit/HTTP checks pass (24 tests): branch/project validation, same-origin and
  Host checks, run transitions, interrupted runs, artifact confinement, JSON/log
  browsing, and rejection of non-Tailscale listener addresses.
- Docker browser regression passes with real healthy/seeded CLI runs, live
  activity, pass/fail reports, screenshots/diffs, reload persistence and mobile
  layout. Preview evidence: `/tmp/spotter-dashboard-desktop.png`,
  `/tmp/spotter-dashboard-mobile.png`.
- Main regression: 66 page variants and 308 fault visits; the same 17 known
  finding groups, no unexpected findings. Report:
  `~/spotter/hockeystats-webapp/runs/20261022-155312-main-587ba74b/report.md`.
- Full seeded regression: all six intended defects plus the seeded content’s
  landmark finding are new (seven groups); 17 existing, zero fixed, no unrelated
  new findings. All 374 screenshots are available for visual review. Report:
  `~/spotter/hockeystats-webapp/runs/20261022-155314-verify-browser-depth-defects-ed54b828/report.md`.
- Caddy configuration and systemd unit validate. Temporary hosting verified
  project/branch discovery and a real report through Tailscale ports 8088/8089;
  both listeners bound only `100.87.100.20`, and loopback access was refused.
  Temporary servers were stopped. Persistent service installation and sample
  acceptance remain pending; setup is in `docs/dashboard.md`.


## QA-07

**QA-07 evidence (2026-10-22):**

- `npm test`: 30 tests pass. Five Docker browser integrations pass, including
  generic form/cookie and OAuth flows, a seeded state-validation defect reported
  as new, session isolation, one-time state seeding, private-output redaction,
  live-mode selection and missing-credential errors.
- Real Docker-wrapper checks: a private state file mounted read-only yields
  two passing session specs; explicit live mode forwards a synthetic credential
  and passes its selection smoke check without requiring the private state
  mount. This does not establish real-provider sign-in.
- Full HockeyStats main: the same 17 known finding groups. Full seeded branch:
  seven new groups (six intended defects plus their landmark violation), 17
  existing, zero fixed, no unrelated additions. Reports:
  `~/spotter/hockeystats-webapp/runs/20261022-181645-main-31189b8b/report.md` and
  `~/spotter/hockeystats-webapp/runs/20261022-181905-verify-browser-depth-defects-f03b10f1/report.md`.
- HockeyStats owns `react/qa/sign-in.spec.mjs`: 24 passing dialog/Discord specs
  at 375/1280 in light/dark. Its separate local `hockeystats-auth` config selects
  the spec and a controlled Discord build; standard project sweeps keep their
  existing configuration. Use `--working-tree --no-baseline` until the new spec
  is committed and available for comparison. Auth fixtures have been recorded.
  Final CLI report: `~/spotter/hockeystats-auth/runs/20261022-183619-working-tree-b5badd20/report.md`;
  typecheck, unit tests, format and all 24 specs pass. The overall run exits 1
  for nine other finding groups, each also present in the main report.
- Usage and evidence boundaries: [authentication testing](authentication.md).
  Product Owner accepted the sample report 2026-10-22. No real provider credentials
  were used; backend security and a human screen-reader pass are not claimed.

## QA-09

**QA-09 evidence (2026-10-23):**

- `npm test`: 71 tests pass. Docker integrations pass: specs 3/3 (including a
  grep that selects zero tests), browser-depth 2/2 (session `expectSelector`
  matched and missed, no finding added), dashboard 1/1 (INCOMPLETE badge,
  coverage line and gap list).
- Real seeded runs against a scratch HockeyStatsWebApp clone with a temporary
  config (`coverage.required: [format, specs]`, `minSpecs: 1`, member
  `expectSelector`): unchanged branch with optional `--skip rules` passes (exit 0,
  COMPLETE); renamed session key exits 3 (`member: expected state not reached on
  4/4 visits`); required `format` skipped exits 3; zero selected specs exits 3
  although the runner failure is also on base (previously a PASS); a broken-build
  base exits 3 (`baseline: base did not run: web`). Runs:
  `~/spotter/qa09-seed/runs/`.
- HockeyStats main: the same 17 known finding groups, coverage COMPLETE
  (66/66 page visits), exit 1. Report:
  `~/spotter/hockeystats-webapp/runs/20261023-035544-main-c8d7c7f7/report.md`.
- Dashboard checked at 1280 and 375 px for INCOMPLETE and PASS runs; no horizontal
  overflow. Not verified: a base side that throws (code-reviewed only).
  Product Owner accepted the sample report 2026-10-23.

## Configuration editor

Configuration editor verification (2026-10-22): all 32 unit/HTTP tests pass.
The Docker browser regression covers create/edit/delete, contextual field and
YAML-cursor suggestions, desktop/mobile layouts and the existing run/report flow.
The real main run retains exactly the accepted 17 finding groups; the seeded
branch retains seven new groups, 17 existing and zero fixed, with identical
finding IDs to the accepted reports. Evidence:
`~/spotter/hockeystats-webapp/runs/20261022-211425-main-aa4e17d8/report.md` and
`~/spotter/hockeystats-webapp/runs/20261022-211426-verify-browser-depth-defects-3d99e273/report.md`.

## QA-08

**QA-08 evidence (2026-10-23, not yet accepted):**

- `npm test`: 85 tests pass (71 before; levels, config, completeness, dashboard
  and report tests added). Docker dashboard integration 1/1 (Level selector with
  four options, `Plan: no level` preview).
- HockeyStats main without levels: plan `no level`, the same 17 known finding
  groups, COMPLETE 66/66, exit 1. Report:
  `~/spotter/hockeystats-webapp/runs/20261023-042342-main-69026e16/report.md`.
- Seeded scratch clone (type error, format error, overflow on `home` and
  `schedule`) with a temporary config (`coverage.required: [typecheck]`,
  `levels.low.routes: [home]`): low reports the type error and home overflow
  only, COMPLETE with 17 exclusions; high reports all seeded defects, COMPLETE
  66/66, lists the four unsupported capabilities and ran its own base side; a
  repeat low run reused the low baseline cache. Unknown level, unconfigured low
  and `record --level` fail with exit 2. Runs: `~/spotter/qa08-levels/runs/`.
- Not verified: `--level` with `--live-auth` rejection (code-reviewed only);
  a dashboard-started run with a non-default level (HTTP-tested with a mock launcher).

## QA-22 to QA-26

**Same-origin API fixtures evidence (2026-10-23, not yet accepted):**

- `npm test`: 112 tests pass (86 before). Docker integration: all 7 files,
  12 tests pass, including the new `integration/same-origin-api.test.mjs`
  (record with a header, redaction, replay, 500/delay fault visits, unrecorded
  call, unconfigured `api-not-replayed`, `ignoreRequests`).
- `examples/same-origin-api` with `web.api.paths`, `headers` and `backend`:
  `spotter record` started the example server, recorded 2×200 and stopped it;
  the token appears in no saved artifact. Replay run COMPLETE, 4 fault visits:
  `~/spotter/same-origin-example/runs/20261023-170721-same-origin-api-fixtures-2dc481e8/report.md`.
  The same app without `web.api` is INCOMPLETE (exit 3) with two
  `api-not-replayed` findings:
  `~/spotter/same-origin-unconfigured/runs/20261023-170729-same-origin-api-fixtures-9df6e0dc/report.md`.
- Setup inference proposes `paths: [/api]`, `recordFrom` for the example and
  `paths: [/admin]`, `recordFrom: http://localhost:5209` for triple-crown
  `card-lab` at `origin/creature-bench`.
- HockeyStats main: the same 17 groups, COMPLETE 66/66, `apiNotReplayed: []`:
  `~/spotter/hockeystats-webapp/runs/20261023-170706-main-f26ec169/report.md`.
  Seeded: all 7 seeded groups new, 17 on base, COMPLETE:
  `~/spotter/hockeystats-webapp/runs/20261023-170706-verify-browser-depth-defects-2c134acb/report.md`.
- triple-crown with its unchanged config: INCOMPLETE (exit 3), six
  `api-not-replayed` findings for `/admin/...`:
  `~/spotter/triple-crown/runs/20261023-171857-origin-creature-bench-a92211aa/report.md`.
- Not verified: SIGINT during a real `spotter record` (SIGTERM is covered by
  `test/backend.test.mjs`); recording triple-crown (needs its API running).

## QA-27

**Host-started recording backend evidence (2026-10-23, not yet accepted):**

- `npm test`: 129 tests pass (112 before). Docker integration (examples
  mounted): 7 files, 12 tests pass, unchanged.
- `examples/host-backend` (Node API that needs a Docker Compose data service,
  so it cannot start in the image), recorded with
  `bin/spotter record host-backend-example --ref host-recording-backend --host-backend`:
  success (1 response recorded, exit 0), startup failure (exit 2, `backend
  exited with code 3 …; see …/backend.log`), readiness timeout (exit 2, `backend
  not ready … after 8s`) and SIGINT to the process group during the container
  record (exit 130). After each: no Compose container, volume or network, no
  server process, no Spotter container, port free, no export folder. Replay run
  COMPLETE/PASS:
  `~/spotter/host-backend-example/runs/20261023-174045-host-recording-backend-9a0ec666/report.md`.
- Setup inference on an export of triple-crown `origin/creature-bench`
  (`card-lab`) proposes `paths: [/admin]`, `recordFrom: http://localhost:5209`
  and the .NET backend with Compose Postgres, EF migrations, `/health` and
  `down -v` stop exactly as in `docs/plans/host-backend.md`, plus the
  `--host-backend` and empty-database notes. Headers are not inferred.
- HockeyStats main: the same 17 groups (390 occurrences) as before QA-27,
  COMPLETE 66/66, `apiNotReplayed: []`:
  `~/spotter/hockeystats-webapp/runs/20261023-180005-main-6a7fe1a1/report.md`.
  An earlier main run (`20261023-174235-main-402aaf65`) added only transient
  `net::ERR_NETWORK_CHANGED` asset/image failures and was repeated.
  Seeded: all 7 seeded groups new, 17 on base, COMPLETE:
  `~/spotter/hockeystats-webapp/runs/20261023-174826-verify-browser-depth-defects-75bd8fe5/report.md`.
- Not verified: recording triple-crown (awaits Product Owner approval); a
  Compose stop command that exceeds 120 s.

## QA-10

**Interaction journeys evidence (2026-10-23, accepted by Product Owner 2026-10-24):**

- No `src/` change. `npm test`: 157/157 pass. Docker integration
  (`journeys`, `specs`, `authentication`, `examples/` mounted): 9/9 pass;
  `integration/journeys.test.mjs` passed three further times without flakes.
- Healthy example: 7 journeys pass with 2 workers. Seeds, each new against the
  healthy run: broken save (T1, plus the persistence journey), duplicate write,
  lost URL state, missing focus restoration and an unguarded admin route.
  `@critical` grep selects 3.
- HockeyStatsWebApp branch `qa-interaction-journeys` (local, not pushed):
  `react/qa/journeys.spec.mjs` with a matchup URL/back-forward journey
  (`@critical`) and a stat-leader dialog keyboard/focus journey. Temporary
  config `projects/qa10-journeys.yml` (HockeyStats config plus `web.specs` and
  `levels.low`):
  low: COMPLETE, 1 critical spec passed, exit 0:
  `~/spotter/qa10-journeys/runs/20261023-233619-working-tree-258630f6/report.md`;
  medium: COMPLETE 66/66, 2 specs passed, nothing new, exit 0:
  `~/spotter/qa10-journeys/runs/20261023-233649-working-tree-0f7ca6f6/report.md`.
  Main has no spec yet, so its base side reports "project specs could not
  complete" (shown as fixed). Enable `web.specs` in the real config only after
  the branch merges.
- Missing-setup hints (Product Owner request, 2026-10-24): the config check
  suggests unlisted project spec files, and web runs without `web.specs` list
  interaction journeys under "Not checked". `npm test` 158/158. The real
  HockeyStats config against the branch shows one new low finding, `config lacks
  inferred web.specs.files qa/journeys.spec.mjs`, plus the "Not checked" entry,
  COMPLETE 66/66, exit 0:
  `~/spotter/hockeystats-webapp/runs/20261024-010411-qa-interaction-journeys-89c9c05a/report.md`.
- Non-invasive adoption (2026-10-24): `*.journey.mjs` naming, accepted by setup
  inference. The example is renamed `items.journey.mjs`; journeys integration
  4/4 and `npm test` 158/158. Triple Crown branch `interaction-journeys`
  (local `97d8aa1`) adds only `card-lab/qa/challenges.journey.mjs`. Card Lab's
  typecheck and Vitest pass unchanged, 4 journeys pass and coverage is
  COMPLETE (temporary `projects/qa10-triple-crown.yml`):
  `~/spotter/qa10-triple-crown/runs/20261024-045901-working-tree-f7218d00/report.md`.
  Triple Crown fixtures were re-recorded 2026-10-24 after removing the
  `admin` route from its config. That route was the API endpoint
  `/admin/ingest-runs/latest`, which now answers 204, and opening it as a page
  aborted recording.

## QA-12

**Browser and device matrix evidence (2026-10-23, accepted by Product Owner 2026-10-23):**

- `npm test`: 157 tests pass (145 before). Docker integration, all files with
  `examples/` mounted: 17/17 pass, including `integration/browser-matrix.test.mjs`
  (one journey and replay spec in Chromium, Firefox, WebKit and iPhone 13; a
  Firefox-only defect new only in Firefox, including its spec; launch failure and
  unknown device messages; legacy names unchanged) and the dashboard test.
- HockeyStats main (legacy config): 19 groups, COMPLETE 66/66, exit 1; every
  finding fingerprint and screenshot name identical to the pre-QA-12 run on the
  same commit (`20261023-193359-main-3ae0f9a4`):
  `~/spotter/hockeystats-webapp/runs/20261023-211520-main-ad7a7897/report.md`.
  Seeded (`/tmp/spotter-depth-seeded`): all 7 seeded groups new, 19 on base,
  COMPLETE, exit 1:
  `~/spotter/hockeystats-webapp/runs/20261023-212127-verify-browser-depth-defects-ab7616a3/report.md`.
- Temporary copy of the config with `levels.high: { browsers: [firefox, webkit],
  devices: [iPhone 13] }`, seeded branch at `--level high`: 220/220 visits
  (`chromium 66, firefox 66, webkit 66, iPhone 13 22`), COMPLETE, exit 1, all 7
  seeded groups new, 528 screenshots each compared with the same case on base:
  `~/spotter/qa12-matrix/runs/20261023-213234-verify-browser-depth-defects-0afa7eab/report.md`.
- Known limitation seen there: HockeyStats logs its shutouts 500 error to the
  console on 62 of 66 Firefox visits (every visit in other cases), so 4 Firefox
  visits flip between base and head and appear as new/fixed console errors.
  Timing-dependent; raising `web.settleMs` or QA-16 flake tracking addresses it.
- Not verified: a real phone (emulation only); an image without Firefox/WebKit
  (covered by an injected launch failure in the integration test).

## QA-11

**Fault recovery evidence (2026-10-24, accepted by Product Owner 2026-10-24):**

- Recovery specs: `examples/recovery` (7 scenarios, 3 `@critical`): disconnect and
  reconnect, 401 sign-in, 403 without Retry, 429 `Retry-After` within a 4 s budget,
  malformed body, 500 with Retry, stale response ignored. Docker
  `integration/recovery.test.mjs` 4/4 with `Date` frozen and 2 workers, healthy
  0 findings. Seeds, each new against healthy: permanently disabled Refresh (T5,
  plus T1 and T3), ineffective Retry (T5, plus T7), stale overwrite (T6 only).
- Sweep fault kinds: `web.faultInjection.kinds` adds `abort`, `401`, `403`, `429`,
  `malformed` to `500`/`delay`; high runs all seven, medium is unchanged.
  `npm test` 162/162 (160 before). Docker integration: browser-depth 4/4 (a
  guarded app: 7 fault visits, nothing above low; an unguarded app: new
  `page crashes during abort response` and `... malformed response`),
  same-origin-api 2/2, browser-matrix 4/4, journeys 4/4, specs 3/3,
  authentication 2/2, contracts 1/1. `visual` 0/1 fails identically on
  unchanged `HEAD` (pre-existing `renderHtmlReport` call shape).
- HockeyStats main (real config, medium plan unchanged): PASS, COMPLETE 78/78,
  34 specs, 362 fault visits, exit 0; only the known low keyboard-focus advisory:
  `~/spotter/hockeystats-webapp/runs/20261024-151617-main-08105cd8/report.md`.
- Seeded (`/tmp/spotter-depth-seeded`): all 7 seeded groups new, 11 on base,
  exit 3. INCOMPLETE only because the 2026-10-23 clone has no spec files
  ("specs: selected zero tests"):
  `~/spotter/hockeystats-webapp/runs/20261024-152317-verify-browser-depth-defects-a0d739a8/report.md`.
- All kinds on a real app (temporary `projects/qa11-faults.yml`: HockeyStats
  config, 3 routes, all seven kinds): 329 fault visits, no fault findings, PASS,
  COMPLETE, exit 0. Plan line shows the kinds:
  `~/spotter/qa11-faults/runs/20261024-153635-main-285afbd7/report.md`.
- Setup inference (Product Owner request, 2026-10-24): the wizard and the run's
  config check suggest fault kinds the app visibly handles (401/403/429 status
  checks, `Retry-After`, online/offline listeners, caught `fetch` or retry
  backoff → `abort`, JSON parsing in `try` → `malformed`). `npm test` 163/163;
  Docker dashboard 1/1. Applied to every config with fault visits on:
  HockeyStats configs (`hockeystats-webapp`, `hockeystatswebapp`,
  `qa10-journeys`) get `[500, delay, abort, 401, malformed]` (apiClient retry and
  JSON catch, authApi 401); Triple Crown configs get `[500, delay, abort,
  malformed]` (libraryStore). `hockeystats-auth` keeps fault visits off; the
  example configs have nothing inferred.
- HockeyStats main with its inferred kinds: 905 fault visits, no fault findings,
  PASS, COMPLETE 78/78, exit 0:
  `~/spotter/hockeystats-webapp/runs/20261024-175742-main-d017420f/report.md`.
- Triple Crown main: 0 fault visits. Main's pages load the static
  `/card-lab-library.json`, not the `/admin` API, so no endpoint is observed
  (not caused by this change). INCOMPLETE only because main has no journey file
  ("No tests found"; it lives on the local `interaction-journeys` branch):
  `~/spotter/triple-crown/runs/20261024-181219-main-23934278/report.md`.
- Not verified: Firefox/WebKit (faults and the example ran in Chromium only);
  consumer adoption of a recovery journey.

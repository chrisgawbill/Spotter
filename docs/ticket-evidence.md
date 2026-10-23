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

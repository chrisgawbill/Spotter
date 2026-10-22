# Spotter Ticket Index

Ticket states: IDEA, READY, ACTIVE, BLOCKED, DONE. Tickets stay IDEA until the
Product Owner promotes or starts one. `Start <ticket>` authorizes only that
ticket.

## Product decisions (Product Owner, 2026-10-22)

- **Purpose:** an independent, automatic QA runner that spits out what it
  spots, so AI coding agents spend fewer tokens on QA. Agents read one short
  report instead of rebuilding Playwright setups, mocks and screenshot loops
  per ticket.
- **Generic, not project-specific:** Spotter knows nothing about any one app.
  Everything project-specific lives in a project config
  (`projects/<name>.yml`). HockeyStatsWebApp is the first project and the
  reference for "a typical project" (Vite + React SPA, separate JSON API,
  pnpm, Vitest, agent-driven tickets).
- **Data:** browser checks run against **recorded API fixtures**, replayed
  deterministically (with the clock frozen at record time). Re-record on
  demand.
- **Triggers:** CLI first (QA-01); Jenkins on every non-default-branch push
  later (QA-03).
- **Runs on this server** in Docker (host Node is 18; the projects need 20+).

## Delivery contract

PM owns scope and evidence review. Each ticket is DONE when its Verify list
passes and the Product Owner accepts a sample report. Reports must stay short:
an agent should be able to act on `report.md` without opening anything else.

| Ticket | Human decision or review checkpoint |
| --- | --- |
| QA-01 | Sample report accepted 2026-10-22. |
| QA-02 | Approved 2026-10-22: localStorage sessions; serious/critical axe violations block, others advisory. Sample report accepted 2026-10-22. |
| QA-03 | Jenkins job shape, the Tailscale port for the HTML report, and whether to post PR comments (needs a GitHub token on the server). |
| QA-04 | Accepted 2026-10-22: project-repo specs with named tests mapping Verify items; sample report accepted. |
| QA-05 | Workflow documentation accepted by Product Owner 2026-10-22. |
| QA-06 | Dashboard implementation and hosting checks ready for review; sample acceptance and persistent service activation pending. |

## Dependency outline

```text
QA-01 -> QA-02, QA-03, QA-04
QA-01 -> QA-05
```

---

## QA-01 — Spotter MVP: static checks, rendered sweep, short report

**Status:** DONE — sample report accepted by Product Owner 2026-10-22.
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

**Goal:** `spotter run <project> --ref <branch>` checks out the branch, runs
the project's checks and a browser sweep, compares with the merge base, and
writes a compact report of what is **new** on the branch.

**Scope:**

- Docker image (Playwright base) and a host wrapper `bin/spotter`.
- Project config (`projects/<name>.yml`): repo path, base branch, working
  directory, install command, checks, text rules, import boundaries, web
  build/routes/viewports/colour schemes, API origin and record source.
- Checkout via `git archive` into a temp dir (never touches the project's
  checkout); `--working-tree` includes uncommitted changes instead.
- **Static stage:** configured commands with parsers for `tsc`, Vitest JSON,
  Prettier, and a generic fallback (exit code + log tail).
- **Rules stage:** forbidden text (in added diff lines, commit messages, or
  files matching a glob) and import boundaries between slices with an
  allowlist.
- **Fixtures:** `spotter record <project>` visits every route against a live
  API and stores responses; `run` replays them. Unrecorded requests get a fast
  404 and a finding telling the agent to re-record.
- **Web stage:** static build served by Spotter at the app's base path; each
  route × viewport × colour scheme is checked for uncaught errors, console
  errors, failed requests, horizontal page overflow (naming the elements that
  stick out), configured error text, and saves a screenshot.
- **Baseline:** the same run on the merge base (cached by commit SHA);
  findings are fingerprinted and split into new / existing / fixed.
- **Report:** `report.md` (short, agent-facing, repro hint per finding),
  `report.json`, screenshots, logs; exit code 1 when anything new is high or
  medium.
- HockeyStatsWebApp project config.

**Out of scope:** signed-in states, accessibility, fault injection (QA-02);
Jenkins, HTML report hosting, visual diff (QA-03); project specs, API contract
checks (QA-04).

**Verify:**

- Unit tests for parsers, fingerprints/baseline split, rules, and the report.
- Run against HockeyStatsWebApp `main` (no new findings against itself).
- Run against a throwaway branch with seeded defects (type error, failing
  test, forbidden import, wide element on one page, AI mention in a commit):
  each shows up as new, nothing else does.

---

## QA-02 — Depth: accessibility, fault injection, signed-in state

**Status:** DONE — implemented, verified and sample report accepted by Product
Owner 2026-10-22. Approved defaults: localStorage session
seeding; serious/critical axe violations block, others are advisory.

- axe-core on every swept page; serious/critical new violations reported.
- Fault injection: each recorded endpoint returns 500, then is delayed, one at
  a time per route; report pages that blank, crash, or never leave loading.
- Signed-in sweep: config hook to seed a session (e.g. localStorage token)
  with recorded authenticated fixtures.
- Keyboard smoke: tab order reaches every interactive element; focus visible.

**Verify:**

- Unit checks for session/fault configuration and endpoint-specific replay.
- Browser regression: anonymous and signed-in recording/replay stay isolated;
  seeded axe, keyboard, crash, blank-page and stuck-loading defects are new
  against a healthy baseline; delayed requests can recover.
- HockeyStatsWebApp main sweep and a throwaway branch with seeded type, test,
  import, overflow, accessibility and keyboard defects.
- Product Owner accepts the sample report.

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

---

## QA-03 — Pipeline: Jenkins, hosted report, visual diff

**Status:** ACTIVE — started by Product Owner 2026-10-22.
Approved: Jenkins Pipeline with a push webhook, Caddy on Tailscale port 8088,
PR comments disabled. Preparing deployment files; live services remain unconfigured.

- Jenkins job runs Spotter on every non-default-branch push of a configured
  project; stores the report as a build artifact.
- HTML report with screenshots served via Caddy on a Tailscale port.
- Visual diff of each page against the base run; changed pages listed with
  before/after/diff images (also serves Product Owner screenshot review).
- Optional PR comment with `report.md` (needs `gh` and a token).

---

## QA-04 — Project specs and API contracts

**Status:** DONE — implemented, verified and sample report accepted by Product Owner 2026-10-22.

Implementation defaults: specs live in the project repository; named Playwright
tests identify ticket Verify items. Optional `web.specs` runs them through a
Spotter fixture/clock adapter. Full re-records compare observed response shapes;
drift remains advisory and is saved alongside fixture snapshots.

- Spotter runs a project's own Playwright specs (e.g. a ticket's Verify list)
  with the same fixtures, clock, and report format.
- Response-shape snapshots from fixtures; re-recording reports contract drift
  between API versions.

**Verify:**

- Unit checks for shape drift, sessions, spec configuration and stable spec fingerprints.
- Browser checks for named spec failures, fixture replay, fixed clock and isolated sessions.
- HockeyStatsWebApp main and seeded-defect runs; a project-owned spec failure is new against a healthy baseline.
- Product Owner accepts a sample report.

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

---

## QA-05 — Adopt Spotter in HockeyStatsWebApp's agent workflow

**Status:** DONE — workflow documentation accepted by Product Owner 2026-10-22.

- `docs/agent-development.md`: coder runs Spotter before handing off; QA
  worker starts from `report.md` and only checks ticket-specific criteria and
  rendered judgment calls.

The workflow now includes committed-ref and working-tree commands, exact run
artifact handoff, exit-code interpretation, and report-first QA. Ticket-required
checks outside Spotter coverage and human acceptance remain required.

Verification: independent documentation review passed; all eight Spotter test
files passed. The main run completed with 17 existing/advisory findings. Seeded
defect verification was not rerun for this documentation change.


---

## QA-06 — Spotter dashboard

**Status:** ACTIVE — started by Product Owner 2026-10-22.

- Product Owner decisions: start runs from the dashboard; text activity first;
  self-hosted access restricted to devices on the Tailscale network.
- Project overview and recent runs, with pass/fail status.
- Start a run by selecting a configured project and a branch.
- Show running tests/runs with live progress and their current activity.
- List completed test reports. Clicking a report opens it inside the dashboard,
  including actionable findings, check results, screenshots, and before/after/diff
  review.
- Provide a live text activity page showing what has completed and what is
  currently running: stage/check and browser route/scenario when applicable.
  Keep the initial implementation simple. Auto-refreshing browser screenshots
  or live video are deferred enhancements.
- Read existing `report.json` artifacts for completed runs; add live progress
  data for active runs.
- Serve only on the Tailscale network; no user sign-in in the initial scope.
- Use `@chrisgawbill/aero-md3-core`, the shared UI styling library used by
  HockeyStatsWebApp. Import its `core.css` and reuse its design tokens and
  component styles for the dashboard.

**Verify:**

- Selecting a configured project and branch starts a run and opens its activity
  page; the page identifies the selected project and branch.
- A running run appears and updates its current activity without a page reload;
  its final status and report become available when it completes or fails.
- A completed report can be opened and read inside the dashboard, including
  findings and associated visual evidence.
- The activity page shows completed and current work, including the current
  browser scenario when applicable, and makes the last update time clear.
- Hosting restricts dashboard and run-control access to the Tailscale network.

Depends on QA-03. Live hosting and Jenkins activation can be coordinated with
this ticket.


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

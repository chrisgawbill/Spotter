# Spotter Ticket Index

Ticket states: IDEA, READY, ACTIVE, BLOCKED, DONE. Tickets stay IDEA until the
Product Owner promotes or starts one. `Start <ticket>` authorizes only that
ticket.

## Tickets at a glance

| Ticket | Status | Scope |
| --- | --- | --- |
| [QA-01](#qa-01--spotter-mvp-static-checks-rendered-sweep-short-report) | DONE | Core runner and short report |
| [QA-02](#qa-02--depth-accessibility-fault-injection-signed-in-state) | DONE | Browser depth |
| [QA-03](#qa-03--pipeline-jenkins-hosted-report-visual-diff) | ACTIVE | Pipeline and hosted reports |
| [QA-04](#qa-04--project-specs-and-api-contracts) | DONE | Project specs and API contracts |
| [QA-05](#qa-05--adopt-spotter-in-hockeystatswebapps-agent-workflow) | DONE | Consumer workflow |
| [QA-06](#qa-06--spotter-dashboard) | ACTIVE | Dashboard |
| [QA-07](#qa-07--generic-authentication-flow-testing) | DONE | Authentication |

Statuses and acceptance below are recorded decisions. Historical test output is
in [ticket evidence](ticket-evidence.md); usage instructions are in the [README](../README.md).

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

| Ticket | Decision or review checkpoint (recorded 2026-10-22) |
| --- | --- |
| QA-01 | Sample report accepted 2026-10-22. |
| QA-02 | Approved 2026-10-22: localStorage sessions; serious/critical axe violations block, others advisory. Sample report accepted 2026-10-22. |
| QA-03 | ACTIVE: Jenkins push webhook and Caddy port 8088 approved; PR comments disabled. Live activation pending. |
| QA-04 | Accepted 2026-10-22: project-repo specs with named tests mapping Verify items; sample report accepted. |
| QA-05 | Workflow documentation accepted by Product Owner 2026-10-22. |
| QA-06 | Dashboard implementation and hosting checks ready for review; sample acceptance and persistent service activation pending. |
| QA-07 | Generic auth support and sample report accepted 2026-10-22. |

## Dependency outline

```text
QA-01 -> QA-02, QA-03, QA-04
QA-01 -> QA-05
QA-02, QA-04 -> QA-07
```

---

## QA-01 — Spotter MVP: static checks, rendered sweep, short report

**Status:** DONE — sample report accepted by Product Owner 2026-10-22.
Historical verification: [evidence](ticket-evidence.md#qa-01).

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

Historical verification: [evidence](ticket-evidence.md#qa-02).


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

Historical verification: [evidence](ticket-evidence.md#qa-04).


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


Historical verification: [evidence](ticket-evidence.md#qa-06).


---

## QA-07 — Generic authentication flow testing

**Status:** DONE — implementation and sample report accepted by Product Owner
2026-10-22.

**Goal:** projects can test sign-in flows and signed-in pages through Spotter,
whether authentication uses a form, cookies, browser storage or an OAuth
redirect/popup. Provider names, selectors, token formats and account assertions
stay in project-owned specs and project configuration; none belong in `src/`.

**Scope:**

- Extend sessions to accept Playwright `storageState` files (cookies and
  localStorage), retaining existing localStorage session configuration and
  anonymous visits. Define file resolution and Docker mounting for private
  session files outside the exported project checkout.
- Use the existing project-spec adapter for interactive login, redirects and
  popups; add shared capabilities only where the adapter prevents these flows.
- Let project specs control authentication responses and assert request bodies,
  including success, rejection, cancellation and expired sessions. Existing
  method/URL fixture matching alone does not distinguish exchange payloads or
  successive responses; avoid requiring a new fixture engine where explicit
  Playwright routing suffices.
- Support optional live authentication with test credentials supplied through
  explicitly selected environment variables. Keep credentials and private
  session files out of committed configuration and reports. Routine branch
  checks use controlled responses; live checks are explicitly selected and
  identified in results.
- Report named flow failures through existing findings and baseline comparison.
  Keep `report.md` short; attach useful failure evidence without exposing tokens,
  passwords or OAuth codes.
- Document the difference between seeded-session checks, simulated browser
  sign-in and live authentication. Browser response replay does not verify
  backend identity linking, encryption or provider configuration.

**Verify:**

- A generic cookie-based form-login example and a separate OAuth redirect
  example both run through the same adapter without app/provider branches in
  Spotter. Cover popup handling if shared support is added for it.
- Session files work in Docker; anonymous and named sessions remain isolated;
  existing localStorage configurations continue to work.
- Named specs cover successful login, rejected login, session restoration,
  expiry and sign-out; OAuth specs additionally cover state/PKCE assertions,
  cancellation and callback cleanup.
- Controlled authentication requests never reach live providers during routine
  checks. Optional live mode gives an actionable failure for missing required
  credentials, and secrets do not appear in reports or captured evidence.
- Seeded flow defects appear as new findings against a healthy baseline.
- Run `npm test`, relevant browser integrations, HockeyStats main and a seeded
  branch. Adopt project-owned AUTH02/SIGNIN-01 specs in HockeyStats as the first
  consumer; backend security assertions remain in its API tests.
- Product Owner accepts a sample report.

Depends on QA-02 and QA-04.

Historical verification: [evidence](ticket-evidence.md#qa-07).

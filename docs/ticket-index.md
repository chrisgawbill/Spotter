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
| [QA-08](#qa-08--configurable-low-medium-and-high-testing-levels) | ACTIVE | Testing levels |
| [QA-09](#qa-09--coverage-and-run-completeness) | DONE | Trustworthy pass results |
| [QA-10](#qa-10--critical-interaction-journeys) | IDEA | Interaction testing |
| [QA-11](#qa-11--fault-recovery-and-response-ordering) | IDEA | Recovery testing |
| [QA-12](#qa-12--cross-browser-and-device-matrix) | IDEA | Browser compatibility |
| [QA-13](#qa-13--data-edge-case-scenarios) | IDEA | Data robustness |
| [QA-14](#qa-14--deployed-application-smoke-checks) | IDEA | Deployment verification |
| [QA-15](#qa-15--performance-regression-budgets) | IDEA | Performance checks |
| [QA-16](#qa-16--failure-traces-and-flaky-test-tracking) | IDEA | Failure diagnosis |
| [QA-17](#qa-17--visual-comparison-controls) | IDEA | Visual review quality |
| [QA-18](#qa-18--project-owned-backend-integration-mode) | IDEA | Server and API testing |
| [QA-19](#qa-19--structured-security-scanner-findings) | IDEA | Security tool integration |
| [QA-20](#qa-20--runner-lifecycle-and-artifact-retention) | IDEA | Runner reliability |
| [QA-21](#qa-21--scheduled-deep-runs) | IDEA | Scheduled coverage |
| [QA-22](#qa-22--same-origin-api-fixtures-by-path-prefix) | ACTIVE | Same-origin API fixtures |
| [QA-23](#qa-23--infer-same-origin-apis-from-dev-server-proxies) | ACTIVE | Setup inference for proxied APIs |
| [QA-24](#qa-24--project-started-backend-for-recording) | ACTIVE | Local recording source |
| [QA-25](#qa-25--recording-request-headers) | ACTIVE | Recording protected APIs |
| [QA-26](#qa-26--incomplete-when-api-traffic-is-not-replayed) | ACTIVE | Trustworthy pass without fixtures |
| [QA-27](#qa-27--host-started-recording-backend-and-backend-detection) | ACTIVE | Recording backends with their own toolchain |
| [QA-28](#qa-28--detect-hand-written-hash-routes-in-setup) | ACTIVE | Setup inference for custom hash routing |
| [QA-29](#qa-29--report-fixtures-recorded-from-an-empty-backend) | IDEA | Trustworthy pass with empty fixtures |
| [QA-30](#qa-30--stale-project-configuration-warning) | ACTIVE | Config drift from the tested branch |
| [QA-31](#qa-31--consistent-report-counts) | ACTIVE | Report accuracy |
| [QA-32](#qa-32--expected-api-statuses) | ACTIVE | Fewer false API-error findings |

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
| QA-09 | Sample report accepted 2026-10-23; exit 3 = incomplete. QA-08 level integration deferred. |

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


---

## Proposed robustness backlog

QA-08 through QA-21 capture the requested feature proposals. All remain IDEA;
writing these tickets does not start implementation or activate services.
Suggested first delivery sequence: QA-08, QA-09, QA-10, then QA-11.

For every ticket below, implementation verification includes `npm test`, the
relevant browser/integration checks, and the main and seeded-defect runs required
by [AGENTS.md](../AGENTS.md). Record artifact paths and failed/skipped checks in
the handoff. Each ticket also requires Product Owner sample-report acceptance
under the delivery contract above.

QA-08 supplies shared level selection; each feature adds only its own configured
coverage to those levels. QA-09 supplies shared completeness reporting. Tickets
can deliver capabilities before these integrations, but must state any deferred
level/completeness integration rather than claiming it is available.

---

## QA-08 — Configurable low, medium and high testing levels

**Status:** ACTIVE — started by Product Owner 2026-10-23. Decisions: low runs only
`coverage.required` checks plus a configured smoke route set; high equals medium
until the wider-scenario tickets land (listed as unsupported); unconfigured levels
are rejected; the dashboard gets a level selector and plan preview.

**Goal:** Let users choose testing depth per run through project configuration, CLI
and dashboard controls. Testing level is independent of finding severity.

**Scope:**

- Add `low`, `medium` and `high` profiles with documented defaults and project
  overrides. Explicit per-run selection overrides the saved default.
- Low runs required checks and a configured critical-route/journey smoke set;
  medium runs the normal configured sweep and acceptance tests; high adds the
  configured wider browser, data, recovery and performance scenarios.
- Preserve existing behavior when no level is configured or selected; adopting
  a level must not silently discard existing configured checks.
- Show the effective execution plan before starting and the selected level,
  executed coverage and intentional exclusions in activity and reports.
- Required checks apply at every level. An explicit skip of a required check
  makes the run incomplete. Higher levels include lower-level selections.
- Use the same resolved plan on branch and baseline; include it in baseline
  cache identity. Unsupported or unconfigured capabilities must be visible;
  high must not imply live access or enable unconfigured checks.

**Verify:**

- Config, CLI and dashboard select the expected plan and reject invalid levels.
- Each level executes its documented matrix; required checks cannot disappear.
- Branch/base plans match, caches do not cross incompatible plans, and exclusions
  are distinguishable from failed or unexpectedly missing work.
- Existing configurations retain their execution behavior without migration.

---

## QA-09 — Coverage and run completeness

**Status:** DONE — implemented, verified and sample report accepted by Product
Owner 2026-10-23. QA-08 level integration is deferred (QA-08 is not implemented;
`completeness.level` is `null`). Usage: [coverage and completeness](../README.md#coverage-and-completeness).
Historical verification: [evidence](ticket-evidence.md#qa-09).

**Goal:** Make it clear what a passing run establishes and prevent missing required
coverage from producing a successful result.

**Scope:**

- Report expected, executed, failed and skipped routes, scenarios and specs;
  support required checks and minimum acceptance-test counts.
- Detect configured specs selecting zero tests and unexplained missing work.
- Allow project-owned session assertions to establish that named sessions
  reached their intended account state rather than redirecting to sign-in.
- Record fixture age/identity and baseline comparison success or failure.
- Keep completeness separate from finding severity and baseline suppression:
  missing required coverage produces an incomplete/error result, even if it
  occurred on the baseline. Document exit-code behavior.
- Integrate QA-08 levels; summarize completeness in Markdown and put details in
  JSON/HTML without claiming unconfigured routes are covered.

**Verify:**

- Seed zero selected tests, a login redirect, a missing required check and a
  failed baseline; each prevents a misleading pass.
- Intentional optional exclusions are explained and healthy complete runs pass.
- Fixture metadata and counts agree across CLI, dashboard and reports.

---

## QA-10 — Critical interaction journeys

**Status:** IDEA

**Goal:** Extend adoption of the existing project-spec adapter to test behavior after
initial page rendering, without building a separate journey language.

**Scope:**

- Provide generic examples for invalid input followed by correction and save,
  duplicate-submit prevention, edits and persistence, filters/pagination,
  URL restoration, back/forward navigation and role-restricted routes.
- Include dialog keyboard operation and focus restoration assertions.
- Keep selectors, expected write payloads, role rules and persistence semantics
  in project-owned specs. Use explicit routing for response sequences.
- Let projects select critical journeys for low level and broader sets for
  medium/high through QA-08; retain isolated contexts and deterministic replay.

**Verify:**

- Healthy examples pass; seeded broken save, duplicate write, lost state,
  focus restoration and unauthorized-route behavior fail named tests.
- Failures compare correctly with the baseline and parallel journeys remain
  isolated. Adopt representative journeys in the first consumer repository.

---

## QA-11 — Fault recovery and response ordering

**Status:** IDEA

**Goal:** Test recovery after failure as well as the initial failure state.

**Scope:**

- Add opt-in examples/scenarios for disconnected requests, 401/403, 429,
  malformed responses and stale responses arriving after newer requests.
- Assert failure, useful error state, retry/reconnect and successful recovery;
  include controls recovering from disabled/loading states.
- Keep endpoint-specific recovery and write-retry expectations in project specs;
  reuse Playwright routing before adding shared fixture machinery.
- Select bounded scenario sets by QA-08 level, preserve healthy replay elsewhere
  and distinguish deliberately injected failures from unexpected failures.

**Verify:**

- Healthy retry, reconnection and latest-response behavior pass.
- Seed permanently disabled controls, ineffective Retry and stale overwrites;
  each appears as a new named failure without injected-error noise.
- Scenario budgets allow documented retry windows and do not leak across tests.

---

## QA-12 — Cross-browser and device matrix

**Status:** IDEA

**Goal:** Extend the Chromium-only coverage with configurable Firefox and WebKit runs.

**Scope:**

- Support explicit browser/device selections for sweeps and project specs,
  including browser installation in the Docker image.
- Use QA-08 to select a small critical matrix for routine runs and a broader
  configured matrix for high runs; bound concurrency and report visit counts.
- Include browser/device identity in artifacts, findings and baseline cache
  inputs; compare each case with its matching baseline.
- Document mobile emulation limits and retain existing Chromium defaults.

**Verify:**

- The same generic journey runs in Chromium, Firefox and WebKit.
- A seeded browser-specific defect is new only in affected cases; artifacts do
  not collide and baseline comparisons never mix browsers.
- Missing browser installations fail actionably; legacy configs still run.

---

## QA-13 — Data edge-case scenarios

**Status:** IDEA

**Goal:** Exercise realistic response variants beyond the recorded happy-path data.

**Scope:**

- Provide project-owned variants for empty results, long text, missing optional
  fields, large lists, Unicode, zero values and unexpected response shapes.
- Reuse spec routing and fixture overrides; keep business validity and expected
  rendering in project specs rather than inventing universal response mutations.
- Run normal error/layout checks in applicable scenarios; select bounded sets
  by QA-08 level and label artifacts with scenario identity.

**Verify:**

- Healthy examples handle each documented variant as specified.
- Seed empty-list crashes, long-text overflow and missing-field crashes; each
  is new against a healthy baseline with stable scenario fingerprints.
- Variants remain deterministic and never alter original recordings.

---

## QA-14 — Deployed application smoke checks

**Status:** IDEA

**Goal:** Check a configured deployed application where local build replay cannot
establish hosting and runtime integration behavior.

**Scope:**

- Add an explicit deployed-target mode for project-owned smoke specs covering
  asset paths, deep-link refresh, redirects and API connectivity.
- Report deployed URL, execution mode and available deployment revision;
  do not compare two exported refs when only one deployment was tested.
- Reuse applicable live-auth credential/privacy protections. Require explicit
  target selection; testing level alone never enables external actions.
- Keep assertions and any permitted writes in project-owned specs; document
  staging setup and distinguish replay results from real integration evidence.

**Verify:**

- A local deployment example passes; broken asset bases, deep links and API
  configuration produce actionable failures.
- Routine replay runs never contact deployed targets; deployed reports do not
  imply a branch/baseline comparison or leak configured credentials.

---

## QA-15 — Performance regression budgets

**Status:** IDEA

**Goal:** Detect measurable resource and responsiveness regressions with repeatable
measurements and configurable project budgets.

**Scope:**

- Start with bundle/asset bytes, request counts and image sizes; add selected
  page/interaction timings with defined measurement boundaries.
- Use repeated samples and a documented aggregation for noisy timings; record
  browser, resource conditions and whether API responses were replayed.
- Compare equivalent branch/base cases and support absolute/relative budgets.
  Default to advisory until projects explicitly enable blocking thresholds.
- Integrate QA-08 so expensive sampling can be reserved for high runs; keep
  detailed measurements in JSON/HTML and stable findings in Markdown.

**Verify:**

- Seed bundle growth, request multiplication and a controlled slow interaction;
  configured budgets detect each without treating measurement noise as a defect.
- Healthy repeated runs establish reproducibility; unlike environments are not
  presented as equivalent and replay timing is not called backend performance.

---

## QA-16 — Failure traces and flaky-test tracking

**Status:** IDEA

**Goal:** Make eligible failures easier to reproduce while preserving evidence of
intermittent failures and existing authentication privacy guarantees.

**Scope:**

- Attach optional Playwright traces for eligible non-sensitive failures, linked
  from HTML; retain concise named failures in Markdown.
- Add bounded diagnostic retries and classify first-fail/retry-pass results as
  flaky, retaining original attempts and evidence rather than silently passing.
- Define configurable flaky-result gating and show attempt history and trends
  for stable test identities. Avoid retries for specs not declared retry-safe.
- Keep private storage/live-auth artifact restrictions; treat traces as sensitive
  artifacts and apply retention/access rules. Level controls may change capture
  or diagnostic depth, not erase an observed failure.

**Verify:**

- A deterministic failure has usable trace evidence; an intermittent example is
  visibly flaky and retains its initial failure.
- Retry limits and non-retry-safe exclusions work; private authentication cases
  produce no newly exposed tokens, session state or raw traces.

---

## QA-17 — Visual comparison controls

**Status:** IDEA

**Goal:** Reduce irrelevant visual noise while making selected visual regressions
reviewable through explicit project settings.

**Scope:**

- Add project-owned dynamic-region masks, targeted component snapshots and
  configurable comparison tolerances with documented defaults.
- Apply identical settings to both comparison sides; record settings in cache
  identity and display masks/tolerances with before/after/diff evidence.
- Keep visual results advisory by default; any blocking policy must be explicit.
  Masked or missing coverage must not imply visual equivalence.
- Integrate selected snapshot sets with QA-08 levels and preserve the portable
  report directory and short Markdown report.

**Verify:**

- A masked dynamic region stops producing noise while an unmasked seeded
  regression remains visible; tolerance boundaries behave as documented.
- Added/removed/resized snapshots remain visible, settings invalidate affected
  cache entries and legacy configurations retain exact-pixel review behavior.

---

## QA-18 — Project-owned backend integration mode

**Status:** IDEA

**Goal:** Support applications requiring a running server and project-owned API tests,
expanding beyond static-build serving.

**Scope:**

- Configure project-owned server startup, readiness, environment, tests and
  teardown commands; support branch/base isolation and noncolliding ports.
- Run API/browser specs against the correct side and report named failures
  through existing findings and baseline comparison.
- Keep database provisioning, seed/reset procedures and backend security
  assertions project-owned; document disposable integration environments.
- Bound startup/test/shutdown time and clean up child processes on failure or
  cancellation. QA-08 selects configured tests without implicitly starting live
  services or using production data.

**Verify:**

- A generic server example starts, becomes ready, runs API/browser tests and
  shuts down on success, startup failure, test failure and cancellation.
- Seed an API regression and detect it as new; branch/base state and ports stay
  isolated and existing static projects continue to work.

---

## QA-19 — Structured security scanner findings

**Status:** IDEA

**Goal:** Make configured security-tool output actionable using the existing check
runner rather than introducing a separate scanning platform.

**Scope:**

- Document dependency and secret scanning through configured project checks;
  choose a small explicit set of structured output formats to parse.
- Normalize supported results into stable findings, severities, locations and
  reproduction hints; retain the generic fallback for unsupported tools.
- Define baseline and exit behavior for scanner errors versus detected issues;
  avoid credentials or matched secret values in persisted output.
- Let projects select scanner commands and QA-08 frequency; document that these
  checks do not establish comprehensive application security coverage.

**Verify:**

- Sanitized dependency and synthetic-secret fixtures produce stable actionable
  findings; an existing issue is separated from a newly introduced issue.
- Tool crashes/malformed output cannot look like a clean scan, and synthetic
  secret values never appear in persisted reports or log excerpts.

---

## QA-20 — Runner lifecycle and artifact retention

**Status:** IDEA

**Goal:** Make cancellation, concurrency and disk usage predictable across dashboard,
CLI and pipeline runs.

**Scope:**

- Add cancellation with process-tree cleanup and explicit final run state;
  configure stage deadlines separately from page/scenario budgets.
- Lock baseline-cache writes across processes and publish cache entries
  atomically; interrupted writes must never become reusable valid baselines.
- Add configurable artifact retention with dry-run visibility; protect active
  runs, referenced baselines and the valid latest-run pointer.
- Report timeout/cancellation distinctly from product findings and preserve
  useful partial evidence. Keep dashboard access restrictions unchanged.

**Verify:**

- Cancel and time out runs during install, server startup and browser work;
  no child processes remain and activity reaches the correct terminal state.
- Concurrent CLI/dashboard-style runs cannot corrupt shared caches.
- Interrupted cache publication is rejected; retention dry runs and actual
  cleanup preserve active artifacts and valid latest links.

---

## QA-21 — Scheduled deep runs

**Status:** IDEA

**Goal:** Keep routine branch checks bounded while automatically running broader
configured coverage on a schedule.

**Scope:**

- Provide a Jenkins scheduling template using QA-08 levels: routine branch
  runs use the configured normal level and scheduled runs select high.
- Record exact ref, level and trigger in activity/reports; define comparison
  behavior for scheduled default-branch runs so existing baseline findings
  remain visible without being mislabeled as new regressions.
- Serialize or queue competing runs consistently with runner locking; expose
  schedule failures through pipeline status and existing reports.
- Document opt-in configuration, time zone, credential requirements, artifact
  retention and how to disable schedules. Do not activate external services as
  part of template delivery or automatically include live checks.

**Verify:**

- Validate trigger/ref/level selection and execute a representative scheduled
  high run; verify its matrix and report metadata.
- Overlapping triggers follow the documented queue policy and failures retain
  artifacts. Document any unavailable live scheduler verification explicitly.

---

## QA-22 — Same-origin API fixtures by path prefix

**Status:** ACTIVE — started by Product Owner 2026-10-23 with QA-23–QA-26.

**Goal:** Record and replay APIs that the app calls on its own origin (for
example `/admin/...` behind a dev-server proxy), not only APIs whose origin the
build reads from an environment variable.

**Context:** A triple-crown `card-lab` run (2026-10-23) passed as COMPLETE
while every API call reached Spotter's static server, received the SPA
`index.html` with HTTP 200, and the app rendered "Library is malformed". The
app uses relative `/admin` paths, so `web.api.envVar` cannot redirect it.

**Scope:**

- Add `web.api.paths` (list of same-origin path prefixes). Matching requests
  are intercepted in the browser context, recorded from `recordFrom` by
  `spotter record`, and replayed in sweeps, fault visits and specs exactly like
  fake-origin requests (fixture keys, unrecorded 404 finding, fault injection,
  frozen clock, per-session maps).
- `envVar` becomes optional when `paths` is set; at least one of the two is
  required. No build-time environment change is needed for `paths`.
- Keep fixture keys stable and independent of the app origin and port so
  recorded maps replay on any Spotter server.
- Document the option in the README config table and browser-check docs.

**Out of scope:** starting a backend (QA-24), recording headers (QA-25).

**Verify:**

- Unit tests for config validation and key normalisation of same-origin paths.
- Browser regression with a generic example app that fetches `/api/...`
  relatively: record, replay, an unrecorded call is reported, a 500/delay fault
  visit runs per endpoint, and the static SPA fallback is never reached for a
  configured prefix.
- Existing env-var projects (HockeyStatsWebApp main and seeded runs per
  AGENTS.md) are unchanged.

---

## QA-23 — Infer same-origin APIs from dev-server proxies

**Status:** ACTIVE — started by Product Owner 2026-10-23 with QA-22–QA-26.

**Goal:** Let project setup propose `web.api.paths` and `recordFrom` when an
app reaches its API through a dev-server proxy.

**Scope:**

- Read `server.proxy` from Vite config syntax (literal keys and string or
  `{ target }` values) without importing the config; propose `paths` from the
  keys and `recordFrom` from a single literal target, with evidence naming the
  file.
- Multiple targets produce a note asking which API to record, matching the
  existing multiple-env-var behaviour.
- When literal `fetch`/client calls use relative paths and no API is inferred,
  add a setup note that API traffic will not be replayed.

**Depends on:** QA-22.

**Verify:**

- Route-discovery/project-setup unit tests for string, object, multiple and
  computed proxy configurations, and for the relative-fetch note.
- Generated config for a generic proxied example validates and records.

---

## QA-24 — Project-started backend for recording

**Status:** ACTIVE — started by Product Owner 2026-10-23 with QA-22–QA-26.

**Goal:** Record fixtures from a backend the project starts locally when there
is no shared live API, so recordings come from reproducible seeded data.

**Scope:**

- Add `web.api.backend: { run, readyUrl, timeoutMs }` used only by
  `spotter record`: start the command in the project checkout, wait for
  `readyUrl`, record from `recordFrom`, then stop the process tree on success,
  failure, timeout and cancellation.
- Seeding and reset stay in the project's command; Spotter runs it and reports
  its log path on failure.
- Sweeps keep replaying fixtures and never start the backend. Running API or
  browser tests against a live server remains QA-18.

**Verify:**

- Integration test with a tiny generic server: ready, record, shutdown; startup
  failure, readiness timeout and interrupted record leave no child process.
- Recorded fixtures from the started backend replay in a normal run.

---

## QA-25 — Recording request headers

**Status:** ACTIVE — started by Product Owner 2026-10-23 with QA-22–QA-26.

**Goal:** Record APIs that require request headers the production build does
not send (for example dev-only identity headers or a test token).

**Scope:**

- Add `web.api.headers` (map) and per-session overrides, applied only to
  requests Spotter forwards to `recordFrom` while recording; values may use
  `${ENV}` references resolved at record time.
- Never write header values into fixtures, reports or logs; redact them using
  the existing secret redaction.
- Replay ignores these headers so fixture keys stay unchanged.

**Depends on:** QA-22 for same-origin recording; works with env-var APIs too.

**Verify:**

- Unit tests for header merging, environment resolution and redaction.
- Recording against a generic server that rejects requests without the header
  succeeds, and the header value appears in no saved artifact.

---

## QA-26 — Incomplete when API traffic is not replayed

**Status:** ACTIVE — started by Product Owner 2026-10-23 with QA-22–QA-25.

**Goal:** A run must not report COMPLETE when the app called an API that Spotter
neither replayed nor recorded.

**Context:** `completeness.mjs` requires fixtures only when `web.api` is set,
so an app with an unconfigured API passes with "no fixtures recorded".

**Scope:**

- During sweeps, record same-origin requests that ask for JSON (`Accept` or
  `fetch`/XHR resource type) and receive `text/html` or the SPA fallback, and
  report each endpoint once as a high finding naming the path.
- If any such request occurs, mark the run INCOMPLETE with a gap
  "API traffic not replayed" and a hint to configure `web.api` (QA-22).
- `web.ignoreRequests` suppresses intended cases. Findings use stable keys
  without ports or query values.

**Depends on:** QA-22 for the remediation it points to; detection is
independent.

**Verify:**

- Completeness and report unit tests for the new gap and its hint.
- Browser regression: a generic app with an unconfigured relative JSON call is
  INCOMPLETE with the finding; the same app with `web.api.paths` and fixtures is
  COMPLETE; HockeyStatsWebApp main stays COMPLETE with no new findings.

---

## QA-27 — Host-started recording backend and backend detection

**Status:** ACTIVE — started by Product Owner 2026-10-23 (alone).

**Goal:** Let `spotter record` start a project's real API when it needs a
toolchain or services the Spotter image lacks (for example .NET with Postgres in
Docker Compose), and let setup propose that backend from the repository.

**Context:** QA-24 runs `web.api.backend.run` inside the Spotter container, which
provides Node only. triple-crown's API (`dotnet run`, Postgres via
`api/docker-compose.yml`, `/health`, port 5209 from `launchSettings.json`)
cannot start there. Recording is launched only from the host through
`bin/spotter`; the dashboard starts runs, not recordings. The container shares
the host network, so a host-started API is reachable at `recordFrom`.

**Scope:**

- `bin/spotter record` starts and stops the backend on the host through a
  Playwright-free host entry point that reuses `src/backend.mjs` and config
  loading (host Node 18): export the ref with `git archive`, start, wait for
  `readyUrl`, run the container `record` with the backend marked as already
  running, stop in every exit path (success, failure, timeout, Ctrl-C).
- Optional `web.api.backend.stop` command, run after the process group stops,
  for services that outlive it (for example `docker compose … down`).
- Host execution requires explicit host-side opt-in that a dashboard config edit
  cannot grant (for example a `--host-backend` flag or a host environment
  allow-list of project names). The command is printed before it runs.
- Setup inference, syntax and file reads only, never running project code:
  - backend candidates: .NET web projects (`Microsoft.NET.Sdk.Web` plus
    `Properties/launchSettings.json` `applicationUrl`), Node server packages
    (`start`/`dev` script plus a server framework dependency), Compose services
    such as Postgres;
  - link a candidate to the frontend when its URL matches the inferred
    `recordFrom` (for example a Vite proxy target); several candidates give a note;
  - `readyUrl` from a literal health route (`MapHealthChecks("/health")` or a
    `/health` handler), otherwise the app URL;
  - propose Compose `up -d --wait` with a matching `stop`, and EF migrations when
    a `dotnet-ef` tool manifest exists;
  - seeding stays project-owned: propose a `seed`/`reset` script when found,
    otherwise note that recordings will reflect an empty database.
- Sweeps (`spotter run`, dashboard runs) never start a backend.

**Out of scope:** API or browser tests against a live backend (QA-18), per-branch
databases and port isolation, building per-project images.

**Depends on:** QA-22, QA-24.

**Verify:**

- Unit tests for the host entry point's lifecycle and opt-in refusal, `stop`
  ordering, and detection for .NET, Node and Compose examples (match, no match,
  several candidates, missing seed note).
- A generic example backend that needs a host-only service records through
  `bin/spotter record` and leaves no process or Compose container behind on
  success, startup failure, readiness timeout and Ctrl-C.
- Setup proposes `paths`, `recordFrom` and `backend` for triple-crown `card-lab`;
  recording against it waits for Product Owner approval.

---

## QA-28 — Detect hand-written hash routes in setup

**Status:** ACTIVE — proposed 2026-10-23 from the triple-crown `creature-bench`
report review.

**Goal:** Setup proposes the hash routes of apps that route on `location.hash`
without a router library.

**Context:** `route-discovery.mjs` recognises router libraries (`HashRouter`,
`createHashRouter`, `createWebHashHistory`, `withHashLocation`, `useHash`) and
literal `to`/`href` values starting with `/` or `#/`. triple-crown card-lab
switches workspaces with `location.hash === "#duel"` and
`location.hash = \`#${area}\``, so setup proposed only `/` and the sweep never
opened Challenge Lab or Duel.

**Scope:**

- Collect string literals compared with `location.hash` or
  `window.location.hash` (`===`, `==`, `!==`, `switch` cases) and literals
  assigned to it. Resolve constants with the existing `resolve`/`literal`
  helpers.
- Propose each as a route with path `/#<value>` (respecting `web.base`) and a
  name derived from the value. Skip `""` and `"#"`.
- Dynamic assignments (template literals with expressions) add a note asking for
  concrete sample routes, like the existing pending-parameter note.
- Values only compared and immediately rewritten with `history.replaceState`
  may be proposed; the route note asks the user to drop legacy aliases.
- Existing router detection and `hash`/`browser` notes are unchanged.

**Verify:**

- `test/route-discovery.test.mjs` cases: literal comparison, `switch` cases,
  constant-resolved values, literal assignment, dynamic assignment note, and no
  routes from unrelated `hash` properties.
- Setup on a copy of triple-crown `origin/creature-bench` `card-lab` proposes
  `/#challenges` and `/#duel` besides `/`. HockeyStatsWebApp setup output is
  unchanged.

---

## QA-29 — Report fixtures recorded from an empty backend

**Status:** IDEA — proposed 2026-10-23 from the triple-crown `creature-bench`
report review.

**Goal:** A report says when its fixtures came from an empty backend, so a PASS
over empty states is not read as full coverage.

**Context:** Setup notes "No seed or reset script found for the backend;
recordings will reflect an empty database", but only on the setup screen. The
triple-crown fixtures hold only empty arrays and 404s; the report said COMPLETE
and listed four expected "no document yet" 404s as new API errors.

**Scope:**

- At record time, store a fixture data summary in `fixtures/api.json`: counts
  of entries with nonempty JSON bodies, empty arrays/objects and 4xx statuses,
  and whether `web.api.backend` has a seed step (`web.api.backend.seeded` or a
  detected seed/reset script).
- When every JSON entry is empty or 4xx, add a coverage note (not a gap)
  "fixtures hold no data; pages show empty states only" to `report.md`, the
  report JSON and the dashboard, with a hint to seed the recording backend.
- No change to exit codes or COMPLETE/INCOMPLETE status.

**Verify:**

- Fixture and completeness unit tests: all-empty, mixed and populated
  recordings; old fixture files without the summary still load.
- Report test for the note's wording and placement. A HockeyStatsWebApp run has
  no new note.

---

## QA-30 — Stale project configuration warning

**Status:** ACTIVE — proposed 2026-10-23 from the triple-crown `creature-bench`
report review.

**Goal:** A run warns when setup inference on the tested head would propose web
settings that the project configuration lacks.

**Context:** triple-crown's config was generated from a `main` checkout without
a theme switch. On `creature-bench` setup infers
`web.colorSchemeStorage` (`card-lab:theme`), but the run used no storage, so the
light and dark visits produced identical screenshots and the light theme was
never checked.

**Scope:**

- During `run`, after exporting the head, run the existing read-only setup
  inference on the exported tree (no installs, no project code) and compare its
  `web.colorSchemeStorage`, `web.routes` and `web.api.paths` with the loaded
  config.
- Report each missing inferred value once as a low finding in a `config` stage
  with the suggested YAML, keyed by setting and value only. Settings already
  present, even with different values, are not reported.
- Separately, when two configured colour schemes produce byte-identical
  screenshots for every visit of a route, report a low finding that the scheme
  setting has no effect.
- `--skip config` and a level setting can turn the inference check off.

**Verify:**

- Unit tests for the comparison (missing, present, differing), finding keys and
  the identical-screenshot check.
- A triple-crown `origin/creature-bench` run with a config lacking `colorSchemeStorage` reports
  the missing `colorSchemeStorage`; with the current config it reports nothing
  new. HockeyStatsWebApp main has no new findings.

---

## QA-31 — Consistent report counts

**Status:** ACTIVE — proposed 2026-10-23 from the triple-crown `creature-bench`
report review.

**Goal:** Every count in a report describes the same unit as its label, so the
summary line, headings and visual summary agree.

**Context:** The triple-crown report said "1 fixed" in the RESULT line
(`describeCounts` counts grouped findings) but "Fixed vs base (4)" in the
heading (`report.mjs` counts ungrouped findings) above a single bullet. The
visual summary said "16 changed pages · 0 unchanged" while the comparison held
4 changed and 12 added screenshots (`report.mjs` and `htmlReport.mjs` count
every entry in `visual.changes`).

**Scope:**

- Section headings for new, fixed and existing findings use the same grouped
  count as the RESULT line; per-visit counts stay in each entry (`4×`).
- The visual summary in `report.md` and `report.html` splits changed, added,
  removed and unchanged screenshots, omitting zero parts, for example
  "4 changed · 12 added".
- Check other count labels in `report.md`, `report.html` and the dashboard for
  the same mismatch and fix any found in the same way.
- Report JSON keeps its current fields; add a grouped count only if a consumer
  needs it.

**Verify:**

- Report and HTML report tests: grouped heading counts for new, fixed and
  existing findings, and visual summaries with changed-only, added-only and
  mixed entries.
- A HockeyStatsWebApp run's report shows matching counts in the RESULT line,
  headings and visual summary.

---

## QA-32 — Expected API statuses

**Status:** ACTIVE — proposed 2026-10-23 from the triple-crown `creature-bench`
report review.

**Goal:** A project can declare an API status that the app handles on purpose,
so it stops producing `api-error` findings while other failures from the same
endpoint are still reported.

**Context:** triple-crown's API returns 404 for lab documents that were never
saved (`/admin/library`, `/admin/ronin-rules`, `/admin/growth-rules`,
`/admin/mlb-snapshot`), and card-lab's hooks turn that 404 into "nothing yet".
Every visit reported four low `api-error` findings. `web.ignoreRequests`
removes all findings for a URL, including the 500s from fault visits, so it is
too broad.

**Scope:**

- Optional `web.api.expectedStatuses`: a list of `{ request, status }` entries,
  where `request` is a method plus a path regex (for example
  `GET /admin/(library|ronin-rules)`) and `status` is one status or a list.
  A replayed response that matches produces no `api-error` finding. Fault
  visits and statuses that aren't listed are reported as before.
- The dashboard configuration editor and `config-fields.mjs` describe the
  field; config validation rejects malformed entries with a clear message.
- Setup inference, read-only: when source code compares an API error's status
  with a literal 4xx value (for example `e.status === 404`) in the function
  that calls a literal API path, propose that path and status, with an evidence
  note to review.

**Out of scope:** Changing default severities for 4xx responses.

**Verify:**

- Config, web-stage and setup-inference unit tests: listed status suppressed,
  other status on the same path still reported, fault 500 still reported,
  malformed entries rejected, and inference from a status comparison.
- With `expectedStatuses` for its four document endpoints, a triple-crown
  `origin/creature-bench` run has no `api-error` findings for them, and its
  500 fault visits are still checked. HockeyStatsWebApp main has no new
  findings.

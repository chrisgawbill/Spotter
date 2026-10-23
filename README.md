# Spotter

Spotter checks a web project against its merge base and reports **new findings**.
It runs configured checks, rules, browser sweeps and project-owned Playwright
specs against recorded API responses. Start with `report.md`; use `report.html`
for screenshots and visual review.

```bash
bin/spotter run my-app --ref feature/my-change      # writes report.md; exit 1 = new high/medium findings, 3 = incomplete coverage
bin/spotter run my-app --repo ~/worktrees/x --working-tree   # another clone, uncommitted changes included
bin/spotter run my-app --ref feature/x --level low         # testing level: low, medium or high
bin/spotter record my-app                           # (re)record API fixtures from the live API (or web.api.backend)
bin/spotter record my-app --host-backend            # start web.api.backend on this host (tools the image lacks)
bin/spotter prune my-app --dry-run                  # list old runs and cache entries that cleanup would delete
bin/spotter list
SPOTTER_TAILSCALE_IP="$(tailscale ip -4)" bin/spotter dashboard # Tailscale-only dashboard
```

Runs in Docker (`bin/spotter build-image` after dependency changes; it builds
itself on first use). Results go to `~/spotter/<project>/runs/<run>/`
(`runs/latest` points at the newest): `report.md`, `report.html`, `report.json`,
`screenshots/`, `logs/`.

Prerequisites: Git, Bash and Docker. The dashboard also requires Tailscale.
Before the first run, create a project config and record fixtures if it uses an API.

## What a run does

1. **Export** the ref with `git archive` (the project's checkout is never touched; `--working-tree` copies uncommitted files instead).
2. **Static:** install, then each configured check. Parsers turn `tsc`, Vitest JSON and Prettier output into findings with file and line; anything else reports exit code and log tail.
3. **Rules:** forbidden text in commit messages, added lines or files (e.g. "no AI mentions", "no `../../` imports"), and import boundaries between slices with an allowlist.
4. **Config:** runs setup's read-only inference on the exported tree (no installs, no project code) and reports, as low findings with suggested YAML, inferred `web.colorSchemeStorage`, routes and `web.api.paths` the configuration lacks. A configured `colorSchemeStorage`, even with other values, is left alone; routes match by path without query. `--skip config` turns it off.
5. **Web:** builds the app with its API URL pointed at a fake origin (and intercepts same-origin `web.api.paths`), serves it, and visits every route × viewport × colour scheme in Chromium with the recorded API responses and the clock frozen at record time. Reports uncaught errors, console errors, failed requests, API errors, requests missing from the fixtures, same-origin data requests answered by the app's HTML page, pages that scroll sideways or cut content off at the right edge (naming the elements), blank pages and configured error text. Saves a full-page screenshot of each, and reports a route whose colour schemes produce byte-identical screenshots on every visit.
6. **Compare:** the same run on the merge base (cached by commit, config, fixtures and Spotter version) splits findings into new / already on base / fixed. Only new ones are listed.
7. **Completeness:** records what the head side actually executed (checks, rules, page visits, specs, session assertions), fixture identity and age, and whether the baseline comparison succeeded. Missing coverage makes the run INCOMPLETE even when the same gap exists on the base. See [Coverage and completeness](#coverage-and-completeness).

## Adding a project

For installation on another server and automatic dashboard startup, see
[self-hosting](docs/self-hosting.md).

Use **Configurations → Set up from folder** in the dashboard to generate a
configuration draft from a server project folder, or copy `examples/project.yml` to `projects/<name>.yml` and customize it.
The `projects/` and `deploy/` directories and root `Jenkinsfile` stay local
and are ignored by Git; share only the templates in `examples/`. Fields:

| Field | Meaning |
| --- | --- |
| `repo`, `baseBranch`, `workdir` | Checkout (absolute host path), branch to compare against, directory commands run in |
| `install` | Dependency install command |
| `checks[]` | `name`, `run` (`{output}` = report file path), `parser` (`tsc`, `vitest`, `prettier`, `generic`), `severity`, optional `repro` |
| `rules.forbiddenText[]` | `id`, `pattern` (regex), `flags`, `in` (`commits`, `added-lines`, `files`), `glob` (relative to `workdir`), `message`, `severity` |
| `rules.importBoundaries[]` | `id`, `root` (slices directory), `aliases`, `allow[]` of `{ from, to }` (`to` may be a path inside a slice; `*` = any) |
| `web.build` | `run`, `outDir`, `env` |
| `web.base` | Base path the app is served under |
| `web.api` | `envVar` the build reads the API origin from and/or `paths` (same-origin prefixes such as `/api`, intercepted in the browser); `recordFrom` live API for `record`; optional record-only `headers` (`${NAME}` = environment value) and `backend` `{ run, readyUrl, timeoutMs, stop }` (`record --host-backend` starts it on the host). See [same-origin APIs](docs/browser-checks.md#same-origin-apis-and-recording) |
| `web.routes[]` | `{ name, path }` (hash routes include `#/`) |
| `web.viewports`, `web.colorSchemes` | Widths (or `{ width, height }`) and `light`/`dark` |
| `web.sessions` | Additional `{ name, localStorage }` or `{ name, storageState, storageOrigin }` sessions; anonymous visits always run. Optional `expectSelector` must match on every sweep visit of that session, proving it reached its signed-in state; optional `apiHeaders` override `web.api.headers` while recording that session |
| `web.specs` | See [spec options](docs/project-specs.md); optional `{ files: ['qa/ticket.spec.mjs'], grep: 'Verify' }`; project-owned Playwright tests run against the same build and recorded fixtures |
| `web.settleMs`, `web.pageTimeoutMs`, `web.concurrency` | Healthy-page settling delay, navigation timeout and parallel visits |
| `web.accessibility`, `web.keyboard` | Enable axe and advisory Tab/focus checks (both default true) |
| `web.faultInjection` | `{ delayMs, timeoutMs, loadingSelector }`, or false to skip endpoint fault visits |
| `web.colorSchemeStorage` | localStorage entries to seed per scheme, for apps with their own theme switch |
| `web.errorText`, `web.ignoreConsole`, `web.ignoreRequests` | Visible text that means failure; regexes to ignore |
| `coverage.required` | Item names that must run: check names, `rules`, `web`, `specs`, `fixtures`, or a session name with `expectSelector`. Skipping one (for example with `--skip`) makes the run incomplete |
| `coverage.minSpecs` | Minimum number of executed (not skipped) project spec tests; requires `web.specs` |
| `levels` | Optional `default` (`low`, `medium`, `high`) and `low: { routes, specs: { grep } }`. See [Testing levels](#testing-levels) |

Projects under `~/projects` are mounted automatically; `--repo` paths elsewhere are mounted on demand.

## Disk usage

After each run that finishes, Spotter deletes that project's older runs, unused
baseline cache entries and leftover work folders. Set the limits with
`SPOTTER_KEEP_RUNS` (default 10) and `SPOTTER_KEEP_BASELINES` (default 5); set
`SPOTTER_AUTO_PRUNE=off` to disable automatic cleanup. In-progress runs and the
run `runs/latest` points to are always kept.

The dashboard's Storage page shows disk use and changes the same settings; they
are saved to `retention.json` in the Spotter data folder. Precedence: command
flags, then environment variables, then saved settings, then the defaults.

`spotter prune [<project>] [--dry-run] [--keep-runs <n>] [--keep-baselines <n>]`
runs the same cleanup on demand for one project or all of them. The flags
override the variables; `--dry-run` only lists what would be removed.

## Coverage and completeness

A run is INCOMPLETE when configured work did not execute without an intentional
reason: install or build failed, a check did not run, specs selected zero tests
or their runner failed, a page visit failed to load, a session's
`expectSelector` was not found, no fixtures are recorded, a same-origin data
request got the app's HTML page instead of replayed data, a `coverage.required`
item was skipped, fewer than `coverage.minSpecs` specs ran, or the baseline
failed (the base run threw, or did not run a check or stage the head ran).
Completeness is judged on the head side only; baseline suppression never hides
it. Intentional `--skip` of a non-required item is listed with its reason and
does not make a run incomplete. Coverage covers configured routes only.

`report.md` shows `RESULT: INCOMPLETE`, an `## Incomplete coverage` list and a
one-line `coverage:` summary; `report.html` adds an item table; `report.json`
holds the full `completeness` record. The dashboard shows the same summary.

## Testing levels

`--level low|medium|high` (or the dashboard's Level selector) chooses testing
depth for one run; otherwise `levels.default` applies. Without either, a run
behaves exactly as before and `completeness.level` is `null`.

| Level | Runs |
| --- | --- |
| `low` | Only `coverage.required` checks (the rules stage only when `rules` is required), no config inference, the `levels.low.routes` smoke set at the first viewport and colour scheme for every session, no fault visits; specs only when required or narrowed by `levels.low.specs.grep` (which also drops `coverage.minSpecs`) |
| `medium` | The full configured run |
| `high` | Currently the same as medium. Wider browser, data, recovery and performance scenarios are listed as unsupported until QA-11, QA-12, QA-13 and QA-15 add them |

```yaml
levels:
  default: medium
  low:
    routes: [home, standings]
    specs: { grep: '@smoke' }
```

`low` must be configured before it can be selected; unknown or unconfigured
levels fail before a run starts (exit 2). Required items are never excluded.
The branch and its merge base run the same plan, and the plan is part of the
baseline cache key. The run prints its plan first; reports and the dashboard
show a `plan:` line, and each exclusion appears as an `excluded` coverage item,
which never makes a run incomplete.

## Severity and exit codes

`high` (build/type/test failures, uncaught errors, blank pages) and `medium`
(console errors, layout overflow, rule violations, API 5xx, unrecorded
requests) fail the run (exit 1). `low` (formatting, external asset failures,
recorded API 4xx) is reported but does not fail. Existing findings do not fail
a baseline comparison. Exit 0 means complete coverage and no new blocking
findings; exit 1 means new blocking findings; exit 3 means coverage is
incomplete (findings are still listed); exit 2 means Spotter itself failed.
When several apply, 2 wins over 3, and 3 over 1.

## Development

`npm test` runs the unit tests (Node's test runner). Browser regression checks
need the Spotter image (Chromium and Node 20+):

```bash
docker run --rm --init --ipc host \
  -v "$PWD/src:/opt/spotter/src:ro" \
  -v "$PWD/integration:/opt/spotter/integration:ro" \
  --entrypoint node spotter:latest --test integration/browser-depth.test.mjs
```

Read [AGENTS.md](AGENTS.md) before changing Spotter. Ticket scope and approval
states live in [the ticket index](docs/ticket-index.md).

## Pipeline and visual review

Each run includes a portable `report.html`. It lists screenshot changes against
its merge base with before/after/diff images. Visual changes are advisory;
review them in the HTML report. Keep the whole run directory when copying it.
`report.md` stays short and links to the visual review.

[Jenkins and Caddy setup](docs/pipeline.md) describes push-triggered runs,
build artifacts, and serving reports on Tailscale port 8088. Deployment files
are provided; services are not installed automatically.

## Further reading

| Task | Guide |
| --- | --- |
| Configure accessibility, keyboard, sessions and endpoint faults | [Browser checks](docs/browser-checks.md) |
| Run project-owned acceptance tests; inspect API shape drift | [Project specs and API contracts](docs/project-specs.md) |
| Test sign-in, saved sessions or live authentication | [Authentication](docs/authentication.md) |
| Start runs, edit configurations or generate a draft from a folder | [Dashboard](docs/dashboard.md) |
| Install and maintain a server | [Self-hosting](docs/self-hosting.md) |
| Set up Jenkins and hosted visual reports | [Pipeline](docs/pipeline.md) |
| Find scope, approval state and verification requirements | [Tickets](docs/ticket-index.md) |

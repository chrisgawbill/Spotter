# Spotter

Spotter checks a web project against its merge base and reports **new findings**.
It runs configured checks, rules, browser sweeps and project-owned Playwright
specs against recorded API responses. Start with `report.md`; use `report.html`
for screenshots and visual review.

```bash
bin/spotter run my-app --ref feature/my-change      # writes report.md; exit 1 = new high/medium findings
bin/spotter run my-app --repo ~/worktrees/x --working-tree   # another clone, uncommitted changes included
bin/spotter record my-app                           # (re)record API fixtures from the live API
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
4. **Web:** builds the app with its API URL pointed at a fake origin, serves it, and visits every route × viewport × colour scheme in Chromium with the recorded API responses and the clock frozen at record time. Reports uncaught errors, console errors, failed requests, API errors, requests missing from the fixtures, pages that scroll sideways or cut content off at the right edge (naming the elements), blank pages and configured error text. Saves a full-page screenshot of each.
5. **Compare:** the same run on the merge base (cached by commit, config, fixtures and Spotter version) splits findings into new / already on base / fixed. Only new ones are listed.

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
| `web.api` | `envVar` the build reads the API origin from; `recordFrom` live API for `record` |
| `web.routes[]` | `{ name, path }` (hash routes include `#/`) |
| `web.viewports`, `web.colorSchemes` | Widths (or `{ width, height }`) and `light`/`dark` |
| `web.sessions` | Additional `{ name, localStorage }` or `{ name, storageState, storageOrigin }` sessions; anonymous visits always run |
| `web.specs` | See [spec options](docs/project-specs.md); optional `{ files: ['qa/ticket.spec.mjs'], grep: 'Verify' }`; project-owned Playwright tests run against the same build and recorded fixtures |
| `web.settleMs`, `web.pageTimeoutMs`, `web.concurrency` | Healthy-page settling delay, navigation timeout and parallel visits |
| `web.accessibility`, `web.keyboard` | Enable axe and advisory Tab/focus checks (both default true) |
| `web.faultInjection` | `{ delayMs, timeoutMs, loadingSelector }`, or false to skip endpoint fault visits |
| `web.colorSchemeStorage` | localStorage entries to seed per scheme, for apps with their own theme switch |
| `web.errorText`, `web.ignoreConsole`, `web.ignoreRequests` | Visible text that means failure; regexes to ignore |

Projects under `~/projects` are mounted automatically; `--repo` paths elsewhere are mounted on demand.

## Severity and exit codes

`high` (build/type/test failures, uncaught errors, blank pages) and `medium`
(console errors, layout overflow, rule violations, API 5xx, unrecorded
requests) fail the run (exit 1). `low` (formatting, external asset failures,
recorded API 4xx) is reported but does not fail. Existing findings do not fail
a baseline comparison. Exit 0 means no new blocking findings; exit 2 means
Spotter itself failed.

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

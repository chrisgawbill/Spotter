# Spotter

Independent, automatic QA for web projects. One command checks a branch and
prints a short report of what is **new** on it compared with its merge base,
so coding agents read one report instead of rebuilding test setups,
screenshot loops and API mocks for every ticket.

```bash
bin/spotter run my-app --ref feature/my-change      # prints report.md; exit 1 = new high/medium findings
bin/spotter run my-app --repo ~/worktrees/x --working-tree   # another clone, uncommitted changes included
bin/spotter record my-app                           # (re)record API fixtures from the live API
bin/spotter list
SPOTTER_TAILSCALE_IP="$(tailscale ip -4)" bin/spotter dashboard # Tailscale-only dashboard
```

Runs in Docker (`bin/spotter build-image` after dependency changes; it builds
itself on first use). Results go to `~/spotter/<project>/runs/<run>/`
(`runs/latest` points at the newest): `report.md`, `report.html`, `report.json`,
`screenshots/`, `logs/`.

## What a run does

1. **Export** the ref with `git archive` (the project's checkout is never touched; `--working-tree` copies uncommitted files instead).
2. **Static:** install, then each configured check. Parsers turn `tsc`, Vitest JSON and Prettier output into findings with file and line; anything else reports exit code and log tail.
3. **Rules:** forbidden text in commit messages, added lines or files (e.g. "no AI mentions", "no `../../` imports"), and import boundaries between slices with an allowlist.
4. **Web:** builds the app with its API URL pointed at a fake origin, serves it, and visits every route × viewport × colour scheme in Chromium with the recorded API responses and the clock frozen at record time. Reports uncaught errors, console errors, failed requests, API errors, requests missing from the fixtures, pages that scroll sideways or cut content off at the right edge (naming the elements), blank pages and configured error text. Saves a full-page screenshot of each.
5. **Compare:** the same run on the merge base (cached by commit, config, fixtures and Spotter version) splits findings into new / already on base / fixed. Only new ones are listed.

## Adding a project

For installation on another server and automatic dashboard startup, see
[self-hosting](docs/self-hosting.md).

Copy `examples/project.yml` to `projects/<name>.yml` and customize it.
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
| `web.sessions` | Additional `{ name, localStorage }` sessions; anonymous visits always run |
| `web.specs` | Optional `{ files: ['qa/ticket.spec.mjs'], grep: 'Verify' }`; project-owned Playwright tests run against the same build and recorded fixtures |
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
recorded API 4xx) is reported but does not fail. Exit 2 means Spotter itself
failed.

## Development

`npm test` runs the unit tests (Node's test runner). Browser regression checks
need the Spotter image (Chromium and Node 20+):

```bash
docker run --rm --init --ipc host \
  -v "$PWD/src:/opt/spotter/src:ro" \
  -v "$PWD/integration:/opt/spotter/integration:ro" \
  --entrypoint node spotter:latest --test integration/browser-depth.test.mjs
```

Design and tickets:
[docs/ticket-index.md](docs/ticket-index.md).

## Pipeline and visual review

Each run includes a portable `report.html`. It lists screenshot changes against
its merge base with before/after/diff images. Visual changes are advisory;
review them in the HTML report. Keep the whole run directory when copying it.
`report.md` stays short and links to the visual review.

[Jenkins and Caddy setup](docs/pipeline.md) describes push-triggered runs,
build artifacts, and serving reports on Tailscale port 8088. Deployment files
are provided; services are not installed automatically.

## Browser depth

The sweep runs axe on every route × viewport × scheme × session. New serious
or critical violations are medium severity; minor/moderate violations and
keyboard smoke findings are advisory. Keyboard smoke presses Tab and checks
reachability and outline/box-shadow focus styles; review other focus styles
manually. Composite widgets with roving tabindex are excluded from unreachable
warnings. Set `web.accessibility: false` or `web.keyboard: false` to skip them.

`web.sessions` adds isolated signed-in visits alongside anonymous visits:

```yaml
web:
  sessions:
    - name: signed-in
      localStorage: { session: '{"userId":"fixture-user","token":"test-token"}' }
  faultInjection:
    delayMs: 2000
    timeoutMs: 5000
    loadingSelector: '[aria-busy="true"], [role="progressbar"]'
```

Use test sessions accepted by the app's frontend; this does not bypass server
authentication. `spotter record` records each session into its own fixture map;
re-record after adding a session. Fixtures and storage values may contain
sensitive test data; keep them private. Session names must be unique letters,
numbers, underscores or hyphens, excluding `anonymous` and object prototype
property names (such as `constructor`).

Fault injection revisits each route/session at the first viewport and scheme.
Each API request observed there gets its own fresh visit returning 500, then a
visit delaying that endpoint. Other endpoints replay normally. After
`timeoutMs` (independent of the healthy-page settling delay), Spotter reports crashes, blank pages and visible loading indicators
(customize `loadingSelector` for the app). Expected injected HTTP errors are
suppressed; loading indicators already present on the healthy visit are excluded.
Loading during a delayed response is advisory: an intentionally pending request
does not prove a stuck page. A 500 loading finding records the configured
observation deadline, not proof that loading never ends.
`delayMs` controls the response delay; use a value above `timeoutMs`
to observe pending requests. Choose settling and fault budgets that allow the
app's retry window to finish. Set `web.faultInjection: false` to skip this sweep.
Screenshots include session and fault identity. Visual comparisons and manual
keyboard/accessibility judgment remain outside this ticket.

## Project specs and API contracts

Keep specs in the project repository, relative to `workdir`. Name tests after
the ticket and its Verify item so failures map directly to acceptance criteria:

```js
const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

test('TICKET-12 Verify 1: standings are visible', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Standings' })).toBeVisible();
});
```

Enable them with `web.specs.files` in the project YAML. Optional `grep` selects
test names using a regular expression. Spotter supplies the Playwright runner;
specs import its adapter as above. Each test gets isolated fixture replay and
the recording's fixed clock. Use `test.use({ spotterSession: 'member',
colorScheme: 'dark' })` for configured sessions and themes. Tests use the built
app's base URL. Failures are high-severity findings compared with the merge
base; `--skip web` also skips specs. Spec discovery or runner failures block.

Every successful `record` writes `fixtures/contracts.json` and
`fixtures/contract-drift.json`. The first recording establishes a baseline;
later recordings compare endpoint/session additions, removals, status codes,
content types and JSON field/type shapes. Values, object key order and array
length/order are ignored. Empty arrays describe no observed item shape, so
later nonempty arrays can show drift. These are observed snapshots, not a
complete API schema. Drift is advisory and does not change the record exit
code. `--merge` retains existing responses, so use a full re-record to detect
changes to existing endpoints.

## Dashboard

[Dashboard setup](docs/dashboard.md): start runs by project and branch, follow live
text activity, and read reports with visual evidence inside the dashboard. Uses
the shared Aero styling library; serves only on the configured Tailscale address.

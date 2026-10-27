# Browser checks

The sweep runs axe on every route × viewport × scheme × session in the primary
browser (see [Browsers and devices](#browsers-and-devices)). New serious
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
      expectSelector: '[data-account-menu]'
  faultInjection:
    delayMs: 2000
    timeoutMs: 5000
    loadingSelector: '[aria-busy="true"], [role="progressbar"]'
    kinds: [500, delay, abort, 429]   # optional; default [500, delay]
```

Use test sessions accepted by the app's frontend; this does not bypass server
authentication. `spotter record` records each session into its own fixture map;
re-record after adding a session. Fixtures and storage values may contain
sensitive test data; keep them private. Session names must be unique letters,
numbers, underscores or hyphens, excluding `anonymous` and object prototype
property names (such as `constructor`).

Optional `expectSelector` is a project-owned session assertion: every healthy
sweep visit of that session must contain a matching element. Use something
only the signed-in state renders, so a silent redirect to sign-in is caught.
A miss does not create a finding; it makes the run incomplete and the report
names the session and how many visits failed.

Fault injection revisits each route/session at the first viewport and scheme.
Each API request observed there gets one fresh visit per fault kind (by default
a 500, then a delay). Other endpoints replay normally. After
`timeoutMs` (independent of the healthy-page settling delay), Spotter reports crashes, blank pages and visible loading indicators
(customize `loadingSelector` for the app). Expected injected HTTP errors are
suppressed; loading indicators already present on the healthy visit are excluded.
Loading during a delayed response is advisory: an intentionally pending request
does not prove a stuck page. Any other kind's loading finding records the configured
observation deadline, not proof that loading never ends.
`kinds` chooses the faults: `500`, `delay`, `abort` (connection dropped),
`401`, `403`, `429` (with `Retry-After: 1`) and `malformed` (the recorded
status with an unreadable JSON body). The default is `500` and `delay`; level
`high` runs all seven and `low` runs none. Every kind and endpoint is a
separate visit, so all seven take about three and a half times as long as the
default. Kinds report the same crash, blank and loading findings, named after
the kind (`page crashes during abort response`). Proving that Retry or
reconnecting works needs a [recovery spec](project-specs.md#recovery-scenarios).
`delayMs` controls the response delay; use a value above `timeoutMs`
to observe pending requests. Choose settling and fault budgets that allow the
app's retry window to finish. Set `web.faultInjection: false` to skip this sweep.
For faster routine sweeps, configure fault visits independently of healthy visits:

```yaml
web:
  faultInjection:
    concurrency: 32           # default: web.concurrency, per head/base side
    routes: [home, team]       # configured route names; high always uses all routes
    terminalSelector: '[data-fault-finished]' # optional, app-owned terminal state
    minObservationMs: 8000     # required with terminalSelector; cover all retries
    timeoutMs: 20000           # maximum observation time after navigation
```

Without these options, existing behavior is unchanged. Route selection applies to
medium and runs without a level; it leaves healthy visits and specs unchanged.
High ignores the route selection and still runs every endpoint/fault combination.
The plan lists selected fault routes. A fault concurrency override shares the same
pool across kinds and endpoints, separately from healthy visits and spec workers;
an uncached baseline can double the configured number. Tune it for host capacity.

Early completion is opt-in. Choose a selector that means the app has finished
handling the injected failure, and a minimum observation time covering its full
retry/backoff budget. After that minimum, a visible terminal state must persist
for 500 ms with quiet networking and no visible loading indicators. The targeted
endpoint must have been requested. A selector already visible on the healthy
visit disables early completion for that visit, and delay faults always retain
the full deadline. Missing terminal states use the full deadline. This is a
shorter observation window, not proof that no later failure can occur; recovery
and delayed side effects still need project specs. Invalid selector syntax fails
the page check rather than silently skipping it.

`report.json` saves `head.stages.web.timings` (`healthyMs`, `faultsMs`, `specsMs`),
`faultEarlyCompletions` and `faultRoutes` for reviewing the effect without reruns.

Screenshots include session and fault identity. Review visual changes in `report.html`; keyboard and accessibility judgment
still require human review.


## Performance budgets

Opt in with `web.performance`; without it nothing is measured. Findings come only
from budgets and are advisory (`low`) unless a budget sets `blocking: true`
(`medium`, fails the run).

```yaml
web:
  performance:
    budgets:
      - { metric: build.js, maxIncrease: '10%' }
      - { metric: 'route.*.requests', maxIncrease: 0, blocking: true }
      - { metric: 'route.*.apiRequests', max: 4 }
      - { metric: timing.home.load, maxIncrease: '50%' }
      - { metric: interaction.open details, max: 300 }
    timings: { samples: 5, routes: [home], interactions: { grep: '@perf' } }
```

| Metric | Measured |
| --- | --- |
| `build.js`, `build.css`, `build.images`, `build.fonts`, `build.other`, `build.total` | Bytes of `web.build.outDir` (gzip size for text files, raw for the rest; source maps excluded) |
| `route.<name>.requests`, `.apiRequests`, `.bytes`, `.imageBytes` | One healthy visit per route: first browser, viewport and colour scheme, anonymous session. Bytes are same-origin, non-API response bodies as served |
| `timing.<route>.load` | Navigation start to the end of the `load` event, in fresh contexts one at a time |
| `interaction.<name>` | A project spec's `spotterTiming(name, fn)` boundary; see [project specs](project-specs.md#performance-timings) |

`route.*` and `timing.*` apply a budget to every route. `max` is an absolute limit
and goes through the usual baseline split (a breach already on the base is
existing, not new). `maxIncrease` (`'10%'`, or an amount in the metric's unit)
compares the branch with its merge base.

Timings run only at `--level high`; medium and low leave them out (low leaves out
performance entirely). Each timing is the median of `samples` (3 to 20, default
5). A relative timing regression needs the median over budget **and** the
branch's fastest sample slower than the base's slowest. The branch and base take
turns sampling after both sweeps finish. Timings from a cached base, or from a
different browser, CPU count or sample count, are never compared; reports say
"not comparable". Timings use replayed API responses: they measure the front end,
not backend performance. Page-load samples run without the frozen clock (Chromium
reports no navigation timing under it); if a sample then requests data missing
from the fixtures, the timing is dropped and reported.

`report.md` lists budget findings and one `performance:` line; `report.html` has
a head/base table with the environment; `report.json` holds every measurement.
Add `performance` to `coverage.required` to make a run incomplete when
measurement fails. Example: `examples/performance`.

## Browsers and devices

Every web project gets the browser matrix at `--level high` with no
configuration: Chromium, Firefox and WebKit, plus emulated iPhone 13 (WebKit)
and Pixel 7 (Chromium). Low and medium run Chromium only, unless a project
sets `web.browsers` or `web.devices` for its routine runs; high still adds the
rest:

```yaml
web:
  browsers: [chromium, firefox]     # default [chromium]; any of chromium, firefox, webkit
  devices: ['iPad Mini']            # Playwright device names; default none
```

Each browser visits every route × viewport × scheme × session. Each device
visits every route × scheme × session once, at its own viewport, user agent,
pixel ratio and touch settings, in the engine its Playwright descriptor names
(iPhone and iPad devices run in WebKit, Pixel and Galaxy devices in Chromium).
The first browser is the primary case: only it runs fault visits, axe and
keyboard checks, and `spotter record` visits only it, because fixtures do not
depend on the browser. Low runs only the first browser. All visits share
`web.concurrency`; a high run takes roughly twice as long as medium.

Findings, screenshots and `where` text name the browser or device for every
case except Chromium, so existing configurations keep their names and baselines.
The branch and its merge base run the same matrix, and each case is compared
only with the same case. With more than one case, project specs run once per
case as Playwright projects named after it (`webkit`, `iphone-13`); specs
selected and `coverage.minSpecs` count every case. Live-authentication specs
run in Chromium only. Reports list visits per case on the `web:` line.

Device emulation is not a real phone: WebKit is not Safari, and Chromium with a
mobile user agent is not Chrome for Android. Emulation does not cover
on-screen keyboards, browser chrome, safe areas, real touch input or device
performance. Firefox cannot emulate mobile devices. The Spotter image includes
all three engines; a run that cannot launch one stops with the reason and asks
for `bin/spotter build-image`. An unknown device name stops the run before the
build.

## Same-origin APIs and recording

Apps that call their API with relative paths (for example `fetch('/api/items')`
behind a dev-server proxy) cannot be redirected with `web.api.envVar`. List the
prefixes in `web.api.paths` instead; matching requests on the app's own origin
are intercepted in the browser and recorded, replayed, fault-injected and
reported exactly like the fake API origin. `envVar` and `paths` can be combined;
at least one is required.

```yaml
web:
  api:
    paths: [/api]                    # matches /api and /api/..., not /apix
    recordFrom: http://127.0.0.1:4010  # request path and query are appended
    headers:                         # sent only by spotter record
      x-api-token: '${EXAMPLE_API_TOKEN}'
    backend:                         # started only by spotter record
      run: PORT=4010 node api/server.mjs
      readyUrl: http://127.0.0.1:4010/health
      timeoutMs: 60000
  sessions:
    - name: member
      localStorage: { session: member }
      apiHeaders: { x-user: member }   # overrides web.api.headers for this session
```

Fixture keys are `METHOD /path?sorted=query`, without origin or port, so a
recording replays on any Spotter server. Prefixes are absolute app paths; include
the `web.base` prefix if the app calls under it.

`headers` (and per-session `apiHeaders`) are added only to requests forwarded to
`recordFrom`; replay never uses them and fixture keys do not change. `${NAME}`
is read from the environment when recording starts; an unset variable stops the
recording. Values read from the environment are redacted from stored fixture
text. In Docker, pass the variable names with `SPOTTER_AUTH_ENV`, for example
`SPOTTER_AUTH_ENV=EXAMPLE_API_TOKEN bin/spotter record my-app`.

`backend` starts a project-owned server for recording when there is no shared
live API. `spotter record` runs `run` with bash from the root of the recorded
ref's checkout, waits until `readyUrl` answers 200–399 (default 60 s), records,
then stops the whole process tree, also on failure, timeout or interruption.
Seeding and reset belong in the command. Its output is in
`<fixtures>/logs/backend.log`. Sweeps never start it. The Spotter image provides
Node only, and the container shares the host network.

Optional `stop` runs after the process tree is gone, from the same folder, on
every exit path (limit 120 s), for services that outlive it, such as
`docker compose -p spotter-my-app -f api/compose.yaml down -v`. A failing stop
command is reported on stderr with the log path.

A backend that needs tools the image lacks (.NET, Docker Compose, databases) is
started on the host instead: `bin/spotter record my-app --host-backend`. The
host exports the ref with `git archive`, prints the `run` and `stop` commands,
starts the backend with the host's Node (18+; run `npm ci` in the Spotter
checkout once), records in the container against it, and stops it on success,
failure, timeout and Ctrl-C. Only this command-line flag enables host
execution; no configuration field (and so no dashboard edit) can, and the
dashboard never records. See [`examples/host-backend`](../examples/host-backend/project.yml).

A same-origin request that asks for data (fetch/XHR or `Accept: …json`) and
receives the app's HTML page means the API was neither replayed nor recorded.
Each such endpoint is a high `api-not-replayed` finding, and the run is
INCOMPLETE with an `API traffic not replayed` gap naming the endpoints, even when
the base has the same problem. Configure `web.api.paths` and record, or add an
intended request to `web.ignoreRequests`. Generated setups propose `paths` and
`recordFrom` from a Vite `server.proxy`, and note relative request paths when no
API was found.

A replayed 4xx response is a low `api-error` finding (5xx is medium). When the
app handles a status on purpose, for example a 404 that means "nothing saved
yet", list it in `web.api.expectedStatuses`:

```yaml
web:
  api:
    expectedStatuses:
      - { request: "GET /admin/(library|settings)", status: 404 }
      - { request: "POST /api/items", status: [409, 422] }
```

`request` is a method and a regex matched against the whole request path
(query excluded); `status` is one status from 400 to 599 or a list. A matching
response produces no finding. Other statuses from the same endpoint and endpoint
fault visits are still reported, unlike `web.ignoreRequests`, which drops every
finding for a URL. Setup proposes entries when a function compares an error's
status with a literal 4xx value (`e.status === 404`) beside a literal API call;
review that each one is intended.

Generated setups also propose `backend` when exactly one backend in the
repository serves `recordFrom`: a .NET web project (its launch-profile URL) or a
Node package with a `start`/`dev` script and a server framework. They add a
literal `/health` route as `readyUrl`, the nearest Compose file's image-only
services (`up -d --wait`, with `down -v` as `stop`, under project name
`spotter-<name>`), EF migrations when a `dotnet-ef` tool manifest exists, and a
`seed`/`reset` script when one is found; otherwise a note says recordings will
reflect an empty database. Detection only reads files. Headers are never inferred.

See [`examples/same-origin-api`](../examples/same-origin-api/project.yml) for a
complete example.

See [authentication](authentication.md) for private saved sessions and
[project specs](project-specs.md) for acceptance tests.

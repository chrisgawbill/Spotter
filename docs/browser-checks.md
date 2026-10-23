# Browser checks

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
      expectSelector: '[data-account-menu]'
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

Optional `expectSelector` is a project-owned session assertion: every healthy
sweep visit of that session must contain a matching element. Use something
only the signed-in state renders, so a silent redirect to sign-in is caught.
A miss does not create a finding; it makes the run incomplete and the report
names the session and how many visits failed.

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
Screenshots include session and fault identity. Review visual changes in `report.html`; keyboard and accessibility judgment
still require human review.


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

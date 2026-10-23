# Brief: replay (QA-22, QA-25, QA-26 detection)

This brief is your primary context and is meant to be complete. But it is a summary
written by someone else, and it can be stale or wrong. If the actual code contradicts
it, **the code wins** — follow the code, and report the discrepancy to the coordinator.
Read beyond this brief when you genuinely need to; just don't re-read the full plan to
rediscover what is already written here.

**When you need context or judgement this brief does not give you, ask the coordinator
rather than working it out yourself.** Send it with
`SendMessage({to: "main", message: "..."})` — you are a background subagent, so `"main"`
reaches the coordinating Opus session that briefed you. Say what you were doing, the
specific question, and what you would do absent an answer. Then **stop and wait**; the
coordinator replies by messaging you back, which resumes you with your context intact.
If `SendMessage` is unavailable to you, stop and put the question at the top of your
report instead.

Which way to go:
- **Local and checkable** — what a function returns, which shape a row has, whether a
  guard exists: read the code. That is not a question, that is your job.
- **Design, scope, contract, or priority** — the brief is silent or ambiguous, two
  readings lead to different implementations, the contract seems wrong, the change wants
  a file you do not own: **ask.** Do not decide it yourself. Thinking is the
  coordinator's job and it has the whole picture; you have one slice of it.
- **Already resolved provisionally** — you made a call to keep moving: it still goes in
  `## ESCALATIONS`, even if the tests pass.

A question costs one round trip; a confident wrong guess costs a debugging cycle.

## Ponytail rules (apply to how you write code inside the contract)

- Ladder, stop at the first rung that holds: already in this codebase → reuse it; stdlib → use it;
  native platform feature → use it; installed dependency → use it; one line → one line; only then the
  minimum code that works. Never add a dependency.
- Read the code the change touches and trace the real flow first; then take the shortest correct diff.
- Root cause, not symptom: fix in the shared function all callers route through.
- No unrequested abstractions, no scaffolding for later, no config for values that never change.
  Deletion over addition; boring over clever; fewest files.
- Two stdlib options of the same size: take the one correct on edge cases.
- Never simplify away validation at trust boundaries, error handling, security measures or
  anything the contract requires. Ponytail never licenses skipping or shrinking a contracted item;
  if it seems unnecessary, that is an escalation.
- Non-trivial logic leaves one runnable check behind (the tests listed below); no extra suites.
- Match the surrounding code's comment density, naming and idiom.

## Your files (allow-list)
- `src/config.mjs`
- `src/config-fields.mjs`
- `src/fixtures.mjs`
- `src/stages/web.mjs`
- `src/stages/specsFixture.mjs`
- `test/config.test.mjs`
- `test/fixtures.test.mjs` (new)
- `integration/same-origin-api.test.mjs` (new)

Concurrently, right now: `setup` edits `src/route-discovery.mjs`, `src/project-options.mjs` and their
tests; `backend` edits `src/backend.mjs`, `src/cli.mjs`, `test/backend.test.mjs`; `coverage` edits
`src/completeness.mjs`, `test/completeness.test.mjs`, `test/report.test.mjs`. Do not touch them.
The coverage agent consumes your `summary.apiNotReplayed` exactly as contracted (C3); the backend
agent consumes normalized `web.api.backend` (C1). Do not edit `examples/` (coordinator-owned).

## Task
1. C1: validate and normalize `web.api` and `web.sessions[].apiHeaders`; update the `web.api` field in config-fields.
2. C2: `matchesApiPath`, `apiRequestMatcher`, `recordingHeaders`; route both handlers through the matcher;
   path-based record URL; headers on `route.fetch` only when present; redact stored utf8 entries.
3. C3: build env only with envVar; pass `apiPaths` and recording headers from `visitPage`; treat matched
   app-origin URLs as API in `watchPageProblems`; `apiErrorProblem` title from pathname+search;
   `specsFixture.mjs` passes `apiPaths`.
4. C3 QA-26 detection: `api-not-replayed` finding and `summary.apiNotReplayed`.

## Anchors
- `src/config.mjs:54-86` web validation block (add api checks here, after the faultInjection block);
  `:129` `api:` normalisation; `:139-148` `validSession`; `:150-155` `isHttpUrl` (reuse).
- `src/fixtures.mjs:36-37` replay route registration; `:74-79` record registration and live URL; `:89-95` stored entry.
- `src/stages/web.mjs:82` build env; `:144-155` replay/record; `:159-162` `watchPageProblems` call
  (fault visits forward only uncaught errors); `:277-286` response handler; `:307-314` `apiErrorProblem`;
  `:214-230` returned visit result; `:73` summary object.
- `src/stages/specsFixture.mjs:23-27` replay call.

## Keep
- Fake-origin behaviour byte-identical: same keys, same `api-error` titles (HockeyStatsWebApp baseline
  fingerprints depend on it), same route.fetch call when there are no headers.
- `x-spotter-unrecorded` / `x-spotter-injected` suppression; fault-visit gating at `web.mjs:50`
  (`web.api && web.faultInjection`) — same-origin endpoints must get 500/delay fault visits too.
- Secret redaction of session values in findings (`redactSecrets(problems, secrets)` in `visitPage`).
- `fixtures.mjs` must not import Playwright.

## Required tests
- `test/config.test.mjs`: every C1 message (each invalid shape), envVar-only and paths-only both valid,
  normalized defaults (`envVar: null`, `paths: []`, `headers: {}`, `backend: null`, `timeoutMs: 60000` default),
  session `apiHeaders` accepted and rejected.
- `test/fixtures.test.mjs`: `matchesApiPath` segment boundary (`/api`, `/api/x`, not `/apix`, not `/`);
  `apiRequestMatcher` for fake origin, app origin under/outside prefix, other origin, other port of
  same host; `requestKey` of a same-origin URL on two different ports is equal; `recordingHeaders`
  merging (session wins, lowercased), `${NAME}` resolution, missing/empty env throws the exact message,
  `secrets` holds only resolved `${}` values.
- `integration/same-origin-api.test.mjs` (runs in Docker; model on `integration/browser-depth.test.mjs`):
  a static app (written to a temp `dist/index.html`) that fetches `/api/items` relatively with
  `Accept: application/json`, and a local Node http server as `recordFrom` that returns 401 without
  header `x-api-token` and otherwise JSON that echoes the token value inside the body.
  Config `api: { paths: ['/api'], recordFrom, headers: { 'x-api-token': '${SPOTTER_TEST_TOKEN}' } }`, no envVar.
  Assert: record fills `GET /api/items` with status 200 and the stored entry body does not contain the
  token value; replay sweep has no medium/high findings and `summary.apiNotReplayed` is `[]`;
  fault visits run for `GET /api/items` (500 and delay); an app variant also fetching `/api/missing`
  yields an `unrecorded-request` finding for `GET /api/missing` and the page never received HTML for
  `/api/...` (e.g. the app writes the response content-type into the DOM, or check via
  `page`-free means such as the finding set); an unconfigured app (no `web.api`) fetching `/data/items`
  with Accept JSON yields exactly one `api-not-replayed` high finding after `dedupeFindings`, with title
  ending `GET /data/items`, and `summary.apiNotReplayed` = `['GET /data/items']`; adding
  `web.ignoreRequests: ['/data/']` suppresses both.

## Verification
- Run only your unit files on the host:
  `node --test test/config.test.mjs test/fixtures.test.mjs` (others agents are editing concurrently; do not run the full suite).
- Integration, in Docker (image exists):
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/same-origin-api.test.mjs integration/browser-depth.test.mjs integration/specs.test.mjs integration/contracts.test.mjs`
  All four files must pass (the last three are regression checks of existing fake-origin behaviour).
- Baseline before your change: `npm test` 86/86; the three existing integration files pass.

## Report
Write `docs/plans/api-fixtures-progress/replay.md`: what changed per file, test commands and counts,
anything unverified, `## Required caller changes` if any, and end with `## ESCALATIONS`.

## Contracts (verbatim)

## C1 Config (`src/config.mjs`, replay)

### Raw shape

```yaml
web:
  api:
    envVar: VITE_API_URL          # optional when paths is set
    paths: [/api, /admin]         # optional when envVar is set
    recordFrom: http://localhost:5209
    headers: { X-Dev-Role: Admin, Authorization: 'Bearer ${API_TOKEN}' }   # record only
    backend: { run: 'node server.mjs', readyUrl: http://localhost:4010/health, timeoutMs: 60000 }  # record only
    fakeOrigin: http://api.spotter.test   # accepted, undocumented (existing default)
  sessions:
    - name: member
      localStorage: { session: member }
      apiHeaders: { X-Dev-User: member }  # optional, record only, overrides web.api.headers
```

### Validation (in `normalizeConfig`, only when `web.api !== undefined`; exact messages)

Shared helpers (module-private): `ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/`,
`HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/`, `API_PATH = /^\/[^\s?#*]*[^\s?#*/]$/`,
`validHeaders(map)` = plain object (not array, not null), every key matches HEADER_NAME, every
value is a string, and `value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')` contains no `${`.

1. `web.api` not a plain object, or any key outside `envVar, paths, recordFrom, headers, backend, fakeOrigin`
   → `` `web.api` accepts envVar, paths, recordFrom, headers and backend `` (stop checking api further)
2. neither `envVar` nor `paths` present → `` `web.api` needs `envVar` or `paths` ``
3. `envVar` present and not a string matching ENV_NAME → `` `web.api.envVar` must be an environment variable name ``
4. `paths` present and not a nonempty array of unique strings each matching API_PATH
   → `` `web.api.paths` must list unique same-origin path prefixes such as /api (no trailing slash, query or wildcard) ``
5. `recordFrom` present and not `isHttpUrl` → `` `web.api.recordFrom` must be an http(s) URL ``
6. `headers` present and not `validHeaders` → `` `web.api.headers` must map header names to strings; use ${NAME} for environment values ``
7. `backend` present and not: plain object with only keys `run, readyUrl, timeoutMs`, nonempty
   string `run`, `isHttpUrl(readyUrl)`, `timeoutMs` absent or a positive safe integer
   → `` `web.api.backend` needs a `run` command, an http(s) `readyUrl` and optional positive `timeoutMs` ``
8. Any `web.sessions[i].apiHeaders` present and not `validHeaders` (checked only when the sessions
   array itself is valid) → `` `web.sessions[].apiHeaders` must map header names to strings; use ${NAME} for environment values ``.
   `validSession` must accept the `apiHeaders` key (it ignores unknown keys today; keep it that way).

### Normalized shape (`normalizeWebConfig`)

```js
api: web.api ? {
  fakeOrigin: 'http://api.spotter.test', envVar: null, recordFrom: null, headers: {},
  ...web.api,
  paths: web.api.paths ?? [],
  backend: web.api.backend ? { timeoutMs: 60_000, ...web.api.backend } : null,
} : null
```

Sessions keep their raw keys (so `apiHeaders` is present when configured).

### `src/config-fields.mjs` `web.api` entry (exact)

```js
'web.api': { label: 'Recorded API', type: 'object', example: '  api:\n    envVar: VITE_API_URL\n    paths: [/api]\n    recordFrom: https://api.example.com', help: 'Inside web, name the environment variable the build reads and/or same-origin path prefixes the app calls (paths), plus the live API origin used when recording fixtures. Optional headers (with ${NAME} environment values) and backend { run, readyUrl, timeoutMs } apply only to spotter record.' },
```

## C2 Fixture matching, recording and headers (`src/fixtures.mjs`, replay)

`fixtures.mjs` must stay free of Playwright imports (unit tests run on host Node 18).

```js
/** `/api` matches `/api` and `/api/...`, never `/apix`. */
export function matchesApiPath(pathname, apiPaths) → boolean
  // apiPaths.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

/** Predicate for context.route: the fake API origin, or an app-origin path under web.api.paths. */
export function apiRequestMatcher({ fakeOrigin, apiPaths = [], appOrigin }) → (url: URL) => boolean
  // url.origin === new URL(fakeOrigin).origin || (url.origin === appOrigin && matchesApiPath(url.pathname, apiPaths))

/**
 * Headers forwarded to recordFrom for one session: web.api.headers overlaid with
 * session.apiHeaders, names lowercased, ${NAME} resolved from env. `secrets` lists every
 * resolved value that contained a ${...} reference. Throws when a referenced variable is unset or empty.
 */
export function recordingHeaders(api, session, env = process.env) → { headers: Record<string, string>, secrets: string[] }
  // error text: `Recording header ${name} needs environment variable ${VAR}`

export async function replayFixtures(context, { fakeOrigin, apiPaths = [], appOrigin, fixtures, onUnrecorded, onRequest = () => {}, fault })
export async function recordFixtures(context, { fakeOrigin, apiPaths = [], liveOrigin, appOrigin, entries, headers = {}, secrets = [] })
```

Rules:

- Both register `context.route(apiRequestMatcher({ fakeOrigin, apiPaths, appOrigin }), handler)`;
  handler bodies are otherwise unchanged (OPTIONS 204, unrecorded 404 with `x-spotter-unrecorded`,
  fault 500 with `x-spotter-injected`, delay, CORS headers).
- `requestKey` is unchanged. Keys for same-origin requests are therefore `GET /api/items?a=1`.
- Record URL: `liveBase + url.pathname + url.search` where `url = new URL(request.url())` and
  `liveBase = liveOrigin.replace(/\/+$/, '')`.
- `route.fetch` gets `headers: { ...request.headers(), ...headers }` **only when** `headers` has
  keys; otherwise the call is exactly `route.fetch({ url: liveUrl, timeout: 90_000 })` as today.
- The stored entry is `redactSecrets(entry, secrets)` (import from `./sessions.mjs`) when
  `encoding === 'utf8'`; base64 entries are stored unredacted. The response fulfilled to the
  page is not altered.

## C3 Web stage (`src/stages/web.mjs`, replay)

- `buildApp` sets `[web.api.envVar]: web.api.fakeOrigin` only when `web.api?.envVar`.
- `visitPage` passes `apiPaths: web.api.paths` to replay/record; in record mode it also passes
  `...recordingHeaders(web.api, session)` (headers and secrets).
- `watchPageProblems` treats `apiRequestMatcher(...)` URLs exactly as it treats fake-origin
  URLs today (api-error unless `x-spotter-unrecorded`/`x-spotter-injected`). `apiErrorProblem`
  title becomes `` `API answered ${status}: ${method} ${truncate(pathname + search, 140)}` `` —
  byte-identical to today for fake-origin URLs.
- `specsFixture.mjs` passes `apiPaths: settings.web.api.paths ?? []` to `replayFixtures`.

### QA-26 detection

In `watchPageProblems` (response handler), before the `status < 400` early return:

```js
const parsed = new URL(url);
const request = response.request();
if (parsed.origin === appOrigin && !isApi(parsed)
  && (['fetch', 'xhr'].includes(request.resourceType()) || /json/i.test(request.headers().accept ?? ''))
  && /text\/html/i.test(response.headers()['content-type'] ?? '')
  && !isIgnored(web.ignoreRequests, url)) onNotReplayed(`${request.method()} ${parsed.pathname}`, response.status());
```

`visitPage` keeps a per-visit `Set` of endpoints; on the first sighting per visit, and only for
healthy sweep visits (not fault visits, not record mode), it reports:

```js
{ check: 'api-not-replayed', severity: 'high',
  title: `API request answered with the app's HTML page: ${endpoint}`,
  detail: `The app asked for data on its own origin and got its HTML page (HTTP ${status}).\nConfigure web.api.paths for this prefix and record fixtures, or add it to web.ignoreRequests if intended.`,
  key: { route: null, viewport: null, colorScheme: null, session: null, endpoint } }
```

The null keys make every occurrence share one fingerprint, so `dedupeFindings` keeps one
finding per endpoint per side. Endpoint never includes origin, port or query.

`visitPage` returns `apiNotReplayed: [...set]`; the `runWebStage` summary gains
`apiNotReplayed: string[]` — sorted unique endpoints across healthy visits (always present,
`[]` when none). Every other summary field is unchanged.


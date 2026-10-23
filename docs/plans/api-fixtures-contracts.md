# QA-22–QA-26 same-origin API fixtures — frozen contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

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

## C4 Completeness (`src/completeness.mjs`, coverage)

In `assessCompleteness`, after the page-visit gap and before the fault-visit gap:

```js
const notReplayed = Array.isArray(stages.web?.apiNotReplayed) ? stages.web.apiNotReplayed : [];
if (notReplayed.length) gaps.push(`API traffic not replayed: ${notReplayed.slice(0, 3).join(', ')}${notReplayed.length > 3 ? ` and ${notReplayed.length - 3} more` : ''}; configure web.api.paths and run spotter record ${config.name}`);
```

No new item, no change to `requirableNames`, `listItems` or `summarizeCompleteness`.
`src/report.mjs` is unchanged: the gap renders under `## Incomplete coverage`.

## C5 Backend (`src/backend.mjs`, backend)

Node stdlib only (no Playwright; tested on host Node 18).

```js
/**
 * Starts `run` with bash in its own process group (cwd, env = process.env), output appended
 * to logFile, and resolves once GET readyUrl answers 200–399 (polled every 250 ms, each poll
 * with a 2 s abort). Rejects, after stopping the group, when the command exits first or
 * timeoutMs passes. While running, SIGINT/SIGTERM stop the group and exit the process
 * (130 / 143).
 */
export async function startBackend({ run, readyUrl, timeoutMs, cwd, logFile }) → { stop(): Promise<void> }
```

- Spawn: `spawn('bash', ['-c', run], { cwd, detached: true, stdio: ['ignore', fd, fd] })` with
  `fd` from `openSync(logFile, 'a')`.
- `stop()`: idempotent; `process.kill(-pid, 'SIGTERM')` (ignore ESRCH), wait up to 5000 ms for
  the child's exit, then `process.kill(-pid, 'SIGKILL')`; removes the signal handlers; closes fd.
- Error texts (exact): `backend exited with code ${code} before ${readyUrl} was ready` and
  `backend not ready at ${readyUrl} after ${timeoutMs / 1000}s`.

### CLI wiring (`src/cli.mjs` `recordProject`)

After the install succeeds and before `runWebStage`:

```js
const backendConfig = config.web.api.backend;
const backendLog = path.join(logDir, 'backend.log');
let backend = null;
if (backendConfig) {
  log(`starting backend: ${backendConfig.run}`);
  backend = await startBackend({ ...backendConfig, cwd: exportDir, logFile: backendLog })
    .catch((error) => { throw new Error(`${error.message}; see ${toHostPath(backendLog)}`); });
}
try { /* existing log + runWebStage + built check */ } finally { await backend?.stop(); }
```

USAGE `record` text becomes:

```text
  spotter record <project> [--ref <ref>] [--repo <path>] [--merge]
      Visit every route against the live API (starting web.api.backend first when
      configured) and store its responses as the fixtures runs replay. --merge keeps
      existing entries and adds new ones.
```

`spotter run` never starts the backend.

## C6 Setup inference (`src/route-discovery.mjs`, `src/project-options.mjs`, setup)

### route-discovery

`evidence` gains `proxy: []` and `relativeRequests: []`.

Proxy, inside the existing config block, only when `/^vite\.config\.[cm]?[jt]s$/.test(file)`:
`const proxy = resolve(prop(resolve(prop(config, 'server')), 'proxy'))`.

- `proxy` undefined → nothing.
- `proxy` not an ObjectExpression, or any property that is a SpreadElement, computed, keyed by
  something other than an Identifier/StringLiteral, or whose key does not start with `/`
  (Vite treats `^…` as a regex), or whose key is `/` → push the note once per file:
  `` `Could not statically read server.proxy in ${file}; configure web.api.paths manually.` ``
  and skip that property.
- Otherwise `path = key.replace(/\/+$/, '')`; `target = cleanUrl(literal(value) ?? literal(prop(value, 'target')))`
  (null when not a clean literal URL); push `{ path, target, file }`.

Relative requests, for every CallExpression in every scanned module:
the callee name (Identifier name, or MemberExpression property name) matches
`/fetch|request|^(?:get|post|put|patch|delete)$/i`; for each of the first two arguments, take
`literal(arg)`, or for a TemplateLiteral with expressions its first quasi's cooked text; when that
text matches `/^\/(?!\/)[\w-]/`, push `{ path: text.split(/[?#]/)[0], file }`.

### project-options (after the existing single-env-var `web.api` block)

```js
if (facts.proxy.length) {
  const paths = [...new Set(facts.proxy.map((item) => item.path))];
  const targets = [...new Set(facts.proxy.map((item) => item.target).filter(Boolean))];
  const files = [...new Set(facts.proxy.map((item) => item.file))];
  web.api = { ...web.api, paths };
  const fromProxy = !web.api.recordFrom && targets.length === 1 && facts.proxy.every((item) => item.target);
  if (fromProxy) web.api.recordFrom = targets[0];
  if (targets.length > 1) notes.push(`Multiple API proxy targets found (${targets.join(', ')}); select the API to record.`);
  const proxyEvidence = `${files.join(', ')}: dev-server proxy for ${paths.join(', ')}${fromProxy ? ' to a literal target; verify the recording target' : '; supply the recording URL'}`;
  evidence['web.api'] = evidence['web.api'] ? `${evidence['web.api']}; ${proxyEvidence}` : proxyEvidence;
}
if (!web.api && facts.relativeRequests.length) {
  const shown = [...new Set(facts.relativeRequests.map((item) => item.path))].slice(0, 3).join(', ');
  notes.push(`Relative API requests found in ${facts.relativeRequests[0].file} (${shown}) but no API was detected; their traffic will not be replayed. Configure web.api.paths and recordFrom.`);
}
```

Existing env-var inference, notes and evidence strings stay exactly as they are.

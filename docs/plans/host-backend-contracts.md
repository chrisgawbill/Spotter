# QA-27 host-started recording backend — frozen contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

Host Node is 18. `src/backend.mjs`, `src/config.mjs`, `src/host-record.mjs` and
`src/backend-discovery.mjs` (and everything they import) must never import Playwright,
`src/cli.mjs` or `src/stages/*`.

## C1 Config (`src/config.mjs`, `src/config-fields.mjs`, host)

`web.api.backend` accepts one more optional key, `stop`: a string with non-whitespace content.

- Allowed keys: `run, readyUrl, timeoutMs, stop`.
- Validation message (replaces the QA-24 text exactly):
  `` `web.api.backend` needs a `run` command, an http(s) `readyUrl`, optional positive `timeoutMs` and optional `stop` command ``
- Normalized: `backend: web.api.backend ? { timeoutMs: 60_000, stop: null, ...web.api.backend } : null`.
- No project field enables host execution.

`config-fields.mjs` `web.api` help text: replace
`backend { run, readyUrl, timeoutMs } apply only to spotter record.` with
`backend { run, readyUrl, timeoutMs, stop } apply only to spotter record; bin/spotter record --host-backend starts the backend on this server instead of in the container.`
(The example is unchanged.)

## C2 Stop command (`src/backend.mjs`, host)

```js
export async function startBackend({ run, readyUrl, timeoutMs, stop = null, cwd, logFile }) → { stop(): Promise<void> }
```

`stop()` (still idempotent, still removes the signal handlers first) does, in order:

1. `SIGTERM` to the group, wait up to 5000 ms for the child's exit, `SIGKILL` to the group (unchanged).
2. If the `stop` option is a string: `writeSync(fd, `\n[spotter] stop: ${stop}\n`)`, then
   `spawn('bash', ['-c', stop], { cwd, detached: true, stdio: ['ignore', fd, fd] })` and wait for
   its exit or 120_000 ms (`sleep(120_000, …, { ref: false })`), whichever is first.
   - timeout → `SIGKILL` its process group (ignore ESRCH) and write to `process.stderr`:
     `` `[spotter] backend stop command did not finish within 120s; see ${toHostPath(logFile)}\n` ``
   - exit code ≠ 0 → `` `[spotter] backend stop command exited with code ${code}; see ${toHostPath(logFile)}\n` ``
   - it never throws.
3. `closeSync(fd)`.

`toHostPath` comes from `./paths.mjs`. Because the readiness-failure path and the
SIGINT/SIGTERM handlers already call `stop()`, the stop command runs on success, failure,
startup failure, readiness timeout and interruption, always after the group is gone.
Error texts of `startBackend` are unchanged.

## C3 Container record (`src/cli.mjs`, host)

- `parseArguments`: `else if (flag === '--backend-running') options.backendRunning = true;`
- `recordProject`: when `backendConfig && options.backendRunning` → `log('using the backend started on the host')`
  and do not call `startBackend`; otherwise unchanged (container start when configured).
- USAGE `record` entry becomes exactly:

```text
  spotter record <project> [--ref <ref>] [--repo <path>] [--merge] [--host-backend]
      Visit every route against the live API (starting web.api.backend first when
      configured) and store its responses as the fixtures runs replay. --merge keeps
      existing entries and adds new ones. --host-backend (bin/spotter) starts the
      backend on this machine instead of in the container.
```

`--backend-running` is internal and not listed. `spotter run` and the dashboard never start a backend.

## C4 Host entry point (`src/host-record.mjs`, `bin/spotter`, host)

```js
/**
 * `bin/spotter record <project> --host-backend …`: starts web.api.backend on this machine from an
 * export of the recorded ref, runs the container record against it, and stops it on every exit path.
 */
export async function hostRecord(argv, { loadConfig = loadProjectConfig, record = recordInContainer, log = defaultLog } = {}) → Promise<number>
```

`argv` is everything after `record` (`[project, ...flags]`). Steps, in order:

1. `flags` lacks `--host-backend` → throw `Host backends need --host-backend`.
2. `project` missing or starting with `--` → throw
   `Usage: spotter record <project> --host-backend [--ref <ref>] [--repo <path>] [--merge]`.
3. `config = await loadConfig(project, { includeSessions: false })`;
   `config.web?.api?.backend` missing → throw `` `--host-backend needs web.api.backend in projects/${project}.yml` ``.
4. `repo = --repo value ? path.resolve(value) : config.repo`; `ref = --ref value ?? config.baseBranch`;
   `sha = await resolveCommit(repo, ref)`.
5. `directories = projectDirs(project)`; `exportDir = path.join(directories.work, `record-host-${sha.slice(0, 12)}`)`
   (the `record-` prefix keeps it from pruning for a day); `logFile = path.join(directories.fixtures, 'logs', 'backend.log')`;
   `mkdir(dirname(logFile), { recursive: true })`; `rm(exportDir, { recursive: true, force: true })`.
6. Inside `try { … } finally { rm(exportDir, { recursive: true, force: true }) }`:
   `exportCommit(repo, sha, exportDir)`; then, before anything runs:
   `log(`starting backend on this host in ${exportDir}: ${backend.run}`)` and, when `backend.stop`,
   `log(`afterwards it will run: ${backend.stop}`)`.
7. `started = await startBackend({ ...backend, cwd: exportDir, logFile })`, rejection rethrown as
   `` new Error(`${error.message}; see ${logFile}`) ``.
8. `try { return await record([project, ...flags without '--host-backend', '--backend-running']) } finally { await started.stop() }`.

`defaultLog = (message) => process.stderr.write(`[spotter] ${message}\n`)`.

`recordInContainer(args)` (module-private): `spawn(path.join(spotterRoot, 'bin/spotter'), ['record', ...args], { stdio: 'inherit' })`;
while it runs, `process.once('exit', kill)` sends it `SIGTERM` if the host process exits (removed when
the child exits); resolves `code ?? 1`; rejects on spawn `error`.

Command-line guard, same shape as `cli.mjs`:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  hostRecord(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => { process.stderr.write(`spotter: ${error.message}\n`); process.exit(2); });
}
```

SIGINT/SIGTERM are handled by `startBackend` (stop group, stop command, exit 130/143).

### bin/spotter

Directly after the `build-image` block, before the image check:

```bash
# Backends needing host tools: start them here, record in the container (src/host-record.mjs).
if [[ ${1:-} == record && " ${*:2} " == *' --host-backend '* ]]; then
  exec node "$spotter_dir/src/host-record.mjs" "${@:2}"
fi
```

## C5 Setup detection (`src/backend-discovery.mjs`, `src/project-setup.mjs`, setup)

```js
/** Proposes web.api.backend from repository files. Reads files and syntax only; never runs project code. */
export async function discoverBackend(repo, files, { recordFrom, name, workdir }) → { backend: object | null, evidence: string | null, notes: string[] }
```

`files` are repo-relative POSIX paths (`git -C repo ls-files -z --cached --others --exclude-standard`).
Every read goes through `projectText(repo, file)` from `./project-options.mjs` (bounded, confined).
`yaml` parses Compose files. Helpers (module-private):

- `q(value)` = `value` when `/^[\w./-]+$/`, else single-quoted with `'` → `'\''`.
- `dirOf(file)` = `path.posix.dirname(file)` (`.` at the root); `under(file, dir)` = `dir === '.' || file.startsWith(`${dir}/`)`.
- `ancestors(dir)` = `dir`, its parents, …, `.` (nearest first).
- `rel(from, to)` = `path.posix.relative(from === '.' ? '' : from, to === '.' ? '' : to) || '.'`.
- `sameServer(a, b)`: both parse as URLs, same protocol, same effective port (`url.port` or 80/443),
  and hostnames equal or both in `localhost, 127.0.0.1, [::1], 0.0.0.0`.
- Source scans skip `/(^|\/)(node_modules|dist|build|bin|obj|coverage|tests?|__tests__)\//` and `/\.(test|spec)\./`, at most 500 files per candidate.

### Candidates

**.NET:** each `*.csproj` whose text matches `/<Project\s+Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/` and
whose `${dir}/Properties/launchSettings.json` is in `files` and parses as JSON. Profile = first
entry of `profiles` (object order) with `commandName === 'Project'` and an `applicationUrl` whose
`;`-separated parts include one starting `http://`; `url` = that part, trailing `/` removed. No
such profile → not a candidate. Health = first match of
`/\.Map(?:HealthChecks|Get)\(\s*"(\/(?:[\w-]+\/)*healthz?)"/` in `.cs` files under `dir`.
Label: `` `${csproj} (.NET)` ``.

**Node:** each `package.json` except the frontend's own (`workdir === '.' ? 'package.json' : `${workdir}/package.json``)
that parses, has `scripts.start` or else `scripts.dev` (script name kept), and a dependency or
devDependency in `express, fastify, koa, @hapi/hapi, hono, @nestjs/core, restify, polka` (first in
this order is the framework). Port = first match over its `.js/.mjs/.cjs/.ts/.mts/.cts` sources of
`/\.listen\(\s*(\d{2,5})\b/`, else `/\bPORT\b[^\n;]*?(?:\|\||\?\?)\s*['"]?(\d{2,5})\b/`;
`url = http://localhost:${port}` or `null`. Health = first match of
``/\.(?:get|all|head|route)\(\s*['"`](\/(?:[\w-]+\/)*healthz?)['"`]/``.
Label: `` `${packageFile} (Node ${framework})` ``.

### Linking (only called when the generated config has `web.api`)

Let `labels = candidates.map(label).join(', ')`.

- no candidates → `{ backend: null, evidence: null, notes: [] }`.
- no `recordFrom` → note `` `Backend candidates found (${labels}); set web.api.recordFrom to choose one.` ``
- `matches = candidates.filter((c) => c.url && sameServer(c.url, recordFrom))`
  - 0 → note `` `Backend candidates found (${labels}) but none serves ${recordFrom}; configure web.api.backend manually.` ``
  - more than 1 → note `` `Several backends serve ${recordFrom} (${labels}); configure web.api.backend manually.` ``
  - exactly 1 → propose (below).

### Attachments for the matched candidate `c`

- **Compose:** in the nearest of `ancestors(c.dir)` holding one of `compose.yaml, compose.yml,
  docker-compose.yaml, docker-compose.yml` (first in that order): parse; no `services` object →
  note `` `Could not read ${file}; review whether the backend needs it.` ``; any service with `build`
  → note `` `${file} builds services; review whether the backend needs it.` ``; otherwise attach
  `{ file, services: Object.keys(services) }`.
- **EF migrations (.NET only):** nearest of `ancestors(c.dir)` with `${d}/.config/dotnet-tools.json`
  or `${d}/dotnet-tools.json` (that order) in `files` whose JSON `tools` has `dotnet-ef`;
  `toolDir = d`. Migrations project dir = nearest ancestor holding a `*.csproj` of the first file
  (sorted) under `toolDir` matching `/(^|\/)Migrations\/[^/]+\.cs$/`, else `c.dir`. Env prefix = the
  matched profile's `environmentVariables` entries whose name matches `/^[A-Za-z_][A-Za-z0-9_]*$/`
  and value matches `/^[\w.:\/-]*$/`, as `NAME=value ` (in object order).
- **Seed:** `root` = shortest of `c.dir`, the Compose dir and `toolDir` that exist. Among
  `package.json` files under `root` (sorted), the first with a script named, in priority order,
  `seed`, `db:seed`, `reset`, `db:reset`.

Node install for a package dir `d` (lockfile in `d`): `package-lock.json` → `npm ci`;
`pnpm-lock.yaml` → `pnpm install --frozen-lockfile`; `yarn.lock` → `yarn install --frozen-lockfile`;
otherwise `npm install`. The manager is `npm`, `pnpm` or `yarn` accordingly.

### Proposal

`run` = these parts joined with ` && `:

1. Compose: `` `docker compose -p spotter-${name} -f ${q(compose.file)} up -d --wait` ``
2. .NET:
   - EF: `` `(cd ${q(toolDir)} && dotnet tool restore && dotnet restore ${q(rel(toolDir, c.dir))} && ${envPrefix}dotnet ef database update --project ${q(rel(toolDir, migrationsDir))} --startup-project ${q(rel(toolDir, c.dir))})` ``
     (`dotnet restore` added after the first triple-crown recording: a `git archive` export has no `obj/`, and `dotnet ef` reads project metadata before it builds.)
   - seed (if any): `` `(cd ${q(seedDir)} && ${install} && ${manager} run ${script})` ``
   - `` `exec dotnet run --project ${q(c.dir)} --launch-profile ${q(profileName)}` ``
3. Node: `` `cd ${q(c.dir)}` `` (omitted when `.`), `install`, seed (`` `${manager} run ${script}` `` when the seed is
   in `c`'s own package, otherwise the parenthesised form above with `cd ${q(rel(c.dir, seedDir))}`, because the
   shell is already in `c.dir`; amended by the coordinator after review), `` `exec ${manager} run ${c.script}` ``.

`backend = { run, readyUrl: health ? c.url + health : c.url, timeoutMs: 300000 }`, plus
`stop: `docker compose -p spotter-${name} -f ${q(compose.file)} down -v`` when Compose is attached.

Evidence (one string):
`` `backend inferred from ${c.file}${health ? ` with health route ${health}` : ''}${compose ? `, Compose services ${compose.services.join(', ')} from ${compose.file}` : ''}${ef ? `, EF migrations via ${manifestFile}` : ''}${seed ? `, seed script ${seedFile} ${script}` : ''}; review the command before recording` ``

Notes for a proposal (in this order):

- tools = `.NET SDK` for .NET, `Docker Compose` when attached; when any:
  `` `The proposed web.api.backend needs ${tools.join(' and ')} on this server; record with bin/spotter record ${name} --host-backend.` ``
- no seed: `No seed or reset script found for the backend; recordings will reflect an empty database unless the backend seeds itself.`

### project-setup wiring

- Compute `name` (today line 150) before the web block so it can be passed.
- Inside the supported-build block, right after `config.web = mergeSettings(config.web, options.web);`:

```js
if (config.web.api) {
  const repoFiles = (await exec('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 })).stdout.split('\0').filter(Boolean);
  const found = await discoverBackend(repo, repoFiles, { recordFrom: config.web.api.recordFrom, name, workdir: config.workdir });
  if (found.backend) {
    config.web.api = { ...config.web.api, backend: found.backend };
    evidence['web.api'] = `${evidence['web.api']}; ${found.evidence}`;
  }
  notes.push(...found.notes);
}
```

Existing setup notes, evidence and the generated config for projects without a matching backend
stay byte-identical.

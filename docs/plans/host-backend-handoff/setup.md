# Brief: setup (QA-27 backend detection in project setup)

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
- `src/backend-discovery.mjs` (new), `src/project-setup.mjs`
- `test/backend-discovery.test.mjs` (new), `test/project-setup.test.mjs`

Concurrently, right now: `host` edits `src/config.mjs` (adds optional `web.api.backend.stop`, a nonempty
string, to validation), `src/config-fields.mjs`, `src/backend.mjs`, `src/cli.mjs`, `bin/spotter` and creates
`src/host-record.mjs`. Do not touch them, or `src/project-options.mjs` / `src/route-discovery.mjs`
(import `projectText` from project-options as-is). Your proposals include `stop`; until `host` lands,
`normalizeConfig` at the end of `detectProject` rejects a backend with `stop`. If your project-setup tests
hit that, report it in your report instead of working around it; the coordinator re-runs after both land.

## Task
1. C5 `discoverBackend` in new `src/backend-discovery.mjs`, exactly as specified (strings, order, commands).
2. C5 project-setup wiring (hoist `name`, the repo-wide `git ls-files`, merge into `config.web.api`, evidence, notes).

## Anchors
- `src/project-setup.mjs:107-112` existing source listing/discovery; `:136-143` supported-build block; `:139` insertion point; `:150` `name` to hoist.
- `src/project-options.mjs:5-9` `projectText(folder, file)` (returns '' for missing/oversized/outside).
- `src/project-options.mjs:31-41` how proxy inference sets `web.api.paths`/`recordFrom` and `evidence['web.api']`.
- `test/project-setup.test.mjs:13-22` fixture helper; `:125-150` proxy tests to model new ones on.

## What to keep
- Existing setup output for projects without backend candidates must be byte-identical (existing tests pass unchanged).
- Never execute project code; reads only. Never name any real project in src or tests; use generic names.

## Required tests
`test/backend-discovery.test.mjs` (call `discoverBackend` on temp dirs with literal files):
- .NET: Web SDK csproj + launchSettings (`http` profile with env var) + `MapHealthChecks("/health")` + Compose (postgres image) + `dotnet-tools.json` with dotnet-ef + Migrations folder in a sibling csproj → exact `run`, `readyUrl`, `timeoutMs`, `stop`, evidence and the two notes.
- .NET without health route → readyUrl is the app URL; non-Web SDK csproj is ignored.
- Node: express package with `start` script, `listen(4020)`, `app.get('/health')`, `package-lock.json` and a `seed` script → exact run (cd, npm ci, npm run seed, exec npm run start), no seed note, no tools note.
- Compose with a `build` service → not attached, note.
- No match (candidate on another port) → note, no backend; several matches → note; no recordFrom → note.
- Missing seed note present when no seed script.
`test/project-setup.test.mjs`: one end-to-end `detectProject` on a repo with a Vite proxy frontend in a subfolder plus a Node backend package elsewhere → generated `web.api.backend` and evidence; plus the existing tests unchanged.

## Verification
- `node --test test/backend-discovery.test.mjs test/project-setup.test.mjs test/route-discovery.test.mjs` (host Node 18).
- Do not run the full suite — `host` is editing concurrently and you may see unrelated failures.

## Report
Write `docs/plans/host-backend-progress/setup.md`: files changed, tests and counts, discrepancies,
`## Required caller changes` (or None), `## ESCALATIONS`.

## Contracts (frozen, pasted from docs/plans/host-backend-contracts.md)
# QA-27 host-started recording backend — frozen contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

Host Node is 18. `src/backend.mjs`, `src/config.mjs`, `src/host-record.mjs` and

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
   - EF: `` `(cd ${q(toolDir)} && dotnet tool restore && ${envPrefix}dotnet ef database update --project ${q(rel(toolDir, migrationsDir))} --startup-project ${q(rel(toolDir, c.dir))})` ``
   - seed (if any): `` `(cd ${q(seedDir)} && ${install} && ${manager} run ${script})` ``
   - `` `exec dotnet run --project ${q(c.dir)} --launch-profile ${q(profileName)}` ``
3. Node: `` `cd ${q(c.dir)}` `` (omitted when `.`), `install`, seed (`` `${manager} run ${script}` `` when the seed is
   in `c`'s own package, otherwise the parenthesised form above), `` `exec ${manager} run ${c.script}` ``.

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

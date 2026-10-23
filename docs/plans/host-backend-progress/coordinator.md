# QA-27 host-started recording backend — coordinator progress

## Plan validated against the code (branch host-recording-backend @ e1a68b3)

| Claim | Evidence |
| --- | --- |
| Container record starts the backend in the container after install | `src/cli.mjs:269-283` |
| `parseArguments` has one `else if` per flag; unknown flags throw | `src/cli.mjs:54-81` |
| USAGE `record` entry to replace | `src/cli.mjs:32-35` |
| `startBackend` stop: TERM, ≤5 s, KILL, close fd; idempotent; handlers removed first | `src/backend.mjs:20-28` |
| Readiness failure and timeout call `stop()` before rethrowing | `src/backend.mjs:46-48` |
| SIGINT/SIGTERM handlers call `stop()` then exit 130/143 | `src/backend.mjs:29-33` |
| `backend.mjs` is stdlib-only (host-safe) | `src/backend.mjs:1-3` |
| Backend keys validated as `run, readyUrl, timeoutMs`; message text | `src/config.mjs:168-173` |
| Backend normalized with `timeoutMs` default only | `src/config.mjs:137` |
| `loadProjectConfig` reads storageState files unless `includeSessions: false` (container paths would fail on host) | `src/config.mjs:32,40-41` |
| config.mjs imports only stdlib, yaml, completeness, levels, paths, sessions (no Playwright) | `src/config.mjs:1-8` |
| `exportCommit` and `resolveCommit` are host-safe (`exec.mjs` stdlib only) | `src/git.mjs:7-20`, `src/exec.mjs:1-4` |
| `projectDirs`/`spotterHome` resolve to `~/spotter` on the host, matching bin/spotter's `SPOTTER_HOME` | `src/paths.mjs:6,13-22`, `bin/spotter:8` |
| Prune keeps `record-*` work folders younger than a day | `src/prune.mjs:102` |
| Dashboard launches only `cli.mjs run` (never record, never host code) | `src/dashboard.mjs:201` |
| Image is the Playwright image (Node only) | `Dockerfile:2` |
| Container uses host networking | `bin/spotter:61` |
| Env values reach the container only via `SPOTTER_AUTH_ENV` names | `bin/spotter:30-34` |
| Insertion point for the host branch (after build-image, before image check) | `bin/spotter:13-19` |
| Setup: `name` computed after the web block today | `src/project-setup.mjs:150` |
| Setup: web block merges inferred options here | `src/project-setup.mjs:139` |
| Setup lists files relative to the app folder only (`-- .`), so repo-wide backend files need their own listing | `src/project-setup.mjs:107` |
| `projectText` is the bounded, confined reader to reuse | `src/project-options.mjs:5-9` |
| Proxy inference already yields `paths` + `recordFrom` | `src/project-options.mjs:31-41` |
| Existing config tests pin the backend message and normalized shape | `test/config.test.mjs:91,103` |
| Host has Node 18.19.1 and Spotter `node_modules` (yaml, @babel/parser) | `node --version`; `ls node_modules` |

triple-crown `origin/creature-bench`: `api/src/TripleCrown.Api/TripleCrown.Api.csproj` is
`Microsoft.NET.Sdk.Web`; `Properties/launchSettings.json` profile `http` = `http://localhost:5209`
with `ASPNETCORE_ENVIRONMENT=Development`; `Program.cs:38` `app.MapHealthChecks("/health")`;
`api/docker-compose.yml` has one `postgres:18` image service (no build); `api/dotnet-tools.json`
lists `dotnet-ef`; migrations live in `api/src/TripleCrown.Infrastructure/Persistence/Migrations`;
connection string only in `appsettings.Development.json` (so EF needs the profile env); compose
project name would default to `api`, hence `-p spotter-<name>`. `ingest/package.json` has a `seed`
script, but it pushes through the API (`--api http://localhost:5209`) and lives outside `api/`, so
the seed rule does not select it.

## Baseline before changes

- `npm test` (host Node 18.19.1): 112 tests, 112 pass, 0 fail.
- Docker integration (`spotter:latest`, `examples/` mounted, `--network host`): 12 tests, 12 pass.

## Waves

| Wave | Agent | Files | Status |
| --- | --- | --- | --- |
| 1 | host (C1–C4) | config.mjs, config-fields.mjs, backend.mjs, cli.mjs, host-record.mjs (new), bin/spotter, test/config, test/backend, test/host-record (new) | dispatched |
| 1 | setup (C5) | backend-discovery.mjs (new), project-setup.mjs, test/backend-discovery (new), test/project-setup | dispatched |

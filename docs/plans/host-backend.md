# QA-27 host-started recording backend and backend detection — plan

Product Owner authorization (2026-10-23): QA-27 alone, on top of branch
`same-origin-api-fixtures` (QA-22–QA-26, not yet merged). Branch: `host-recording-backend`.

Trigger: QA-24 starts `web.api.backend.run` inside the Spotter container, which has Node only.
triple-crown `card-lab` proxies `/admin` to `http://localhost:5209`, served by a .NET 10 API
(`api/src/TripleCrown.Api`, `launchSettings.json` profile `http`) that needs Postgres from
`api/docker-compose.yml` and EF migrations (`api/dotnet-tools.json` lists `dotnet-ef`). None of
that can start in the container. The container uses `--network host`, so a backend started on
the host is reachable at `recordFrom`.

| Question | Decision |
| --- | --- |
| Host entry point | `src/host-record.mjs`, run with the host's Node (18). Imports only `backend.mjs`, `config.mjs`, `git.mjs`, `paths.mjs` and stdlib; never Playwright, `cli.mjs` or `stages/`. Arguments: `<project> --host-backend [--ref <ref>] [--repo <path>] [--merge]`. |
| How bin/spotter calls it | `bin/spotter record … --host-backend` execs `node "$spotter_dir/src/host-record.mjs" "${@:2}"` before any Docker step. Every other command is unchanged. |
| Host lifecycle | Load config (sessions not read), resolve `--ref` (default `baseBranch`) in `--repo` or `repo`, `git archive` into `<work>/record-host-<sha12>`, print the commands, `startBackend` there, run `bin/spotter record <same args minus --host-backend> --backend-running` with inherited stdio, then stop the backend and remove the export. Exit code is the container's. |
| How the container learns the backend runs | Internal flag `--backend-running` on `spotter record`: `recordProject` logs `using the backend started on the host` and does not call `startBackend`. Not in USAGE. |
| Opt-in | The `--host-backend` command-line flag, checked inside `host-record.mjs` (it refuses without it). Project YAML has no field that enables host execution, so a dashboard config edit cannot grant it; the dashboard only launches `cli.mjs run` inside its container. Commands are printed before they run. |
| `backend.stop` | Optional nonempty string. Runs inside `startBackend`'s `stop()` **after** the process group is gone (TERM, ≤5 s, KILL), with bash in the same cwd, own process group, output appended to `backend.log`, limit 120 s. Same for in-container (QA-24) and host backends, and on every exit path: success, failure, startup failure, readiness timeout, SIGINT/SIGTERM. A failing stop command warns on stderr; it never replaces the original error. |
| Detection | New `src/backend-discovery.mjs`, file reads and syntax only. Candidates: .NET web projects with a launch-profile URL, Node packages with a `start`/`dev` script and a server framework. Compose files and `dotnet-ef` manifests attach to a candidate; they are not candidates alone. Proposed only when exactly one candidate serves the inferred `recordFrom`. |
| Compose isolation | Proposed Compose commands use `-p spotter-<project>` so they never touch the developer's own Compose project (`api` for triple-crown), and `down -v` so each recording starts from a fresh database. |

## Proposed config for triple-crown (expected, from the rules in C5)

```yaml
web:
  api:
    paths: [/admin]
    recordFrom: http://localhost:5209
    backend:
      run: docker compose -p spotter-triple-crown -f api/docker-compose.yml up -d --wait && (cd api && dotnet tool restore && dotnet restore src/TripleCrown.Api && ASPNETCORE_ENVIRONMENT=Development dotnet ef database update --project src/TripleCrown.Infrastructure --startup-project src/TripleCrown.Api) && exec dotnet run --project api/src/TripleCrown.Api --launch-profile http
      readyUrl: http://localhost:5209/health
      timeoutMs: 300000
      stop: docker compose -p spotter-triple-crown -f api/docker-compose.yml down -v
```

Headers (`X-Dev-User`, `X-Dev-Role`) are not inferred; QA-25 left them manual and QA-27 does not
add header inference.

## How it shows when recording

```text
$ bin/spotter record my-app --host-backend
[spotter] starting backend on this host in /home/u/spotter/my-app/work/record-host-0123456789ab: docker compose -p spotter-my-app -f compose.yaml up -d --wait && exec node server.mjs
[spotter] afterwards it will run: docker compose -p spotter-my-app -f compose.yaml down -v
[spotter] installing main @ 0123456
[spotter] using the backend started on the host
[spotter] recording from http://127.0.0.1:4020
Recorded 2 API responses (2 new, 0 non-2xx) to /home/u/spotter/my-app/fixtures/api.json; clock frozen at ….
```

## Ownership and waves

Contracts C1–C5 are frozen before dispatch; both coders run in one parallel wave.

| Agent | Contracts | Files |
| --- | --- | --- |
| host | C1–C4 | `src/config.mjs`, `src/config-fields.mjs`, `src/backend.mjs`, `src/cli.mjs`, `src/host-record.mjs` (new), `bin/spotter`, `test/config.test.mjs`, `test/backend.test.mjs`, `test/host-record.test.mjs` (new) |
| setup | C5 | `src/backend-discovery.mjs` (new), `src/project-setup.mjs`, `test/backend-discovery.test.mjs` (new), `test/project-setup.test.mjs` |
| coordinator | — | README.md, `docs/*.md`, `docs/plans/host-backend*`, `examples/host-backend/` (new), verification |

Contracts: [host-backend-contracts.md](host-backend-contracts.md).

## Known limits

- The host needs Node 18+ and Spotter's `node_modules` (`npm ci` in the Spotter checkout) for
  `--host-backend`; without the flag nothing changes.
- A second Ctrl-C while the stop command runs exits Spotter at once; the stop command keeps
  running detached until it finishes.
- No port isolation: a developer's own backend or database on the same ports makes startup fail
  (reported with the log path). Per-branch databases remain out of scope.
- The container record resolves `--ref` again; a branch moved between the host export and the
  container build would record a newer commit than the backend runs.
- Detection reads literal values only: computed ports, URLs from environment, Compose files
  that build the API itself, and seed commands that need the running API are left to the user.

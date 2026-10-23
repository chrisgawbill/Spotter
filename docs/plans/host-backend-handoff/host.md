# Brief: host (QA-27 host lifecycle, backend.stop, container flag, bin/spotter)

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
- `src/config.mjs`, `src/config-fields.mjs`
- `src/backend.mjs`, `src/cli.mjs`
- `src/host-record.mjs` (new), `bin/spotter`
- `test/config.test.mjs`, `test/backend.test.mjs`, `test/host-record.test.mjs` (new)

Concurrently, right now: `setup` edits `src/project-setup.mjs` and creates `src/backend-discovery.mjs`
plus their tests. Do not touch them, `src/project-options.mjs`, `src/route-discovery.mjs`, docs or examples.

## Task
1. C1: `stop` key in `web.api.backend` validation/normalization; config-fields help text.
2. C2: stop command inside `startBackend().stop()`.
3. C3: `--backend-running` in `parseArguments` and `recordProject`; USAGE `record` text.
4. C4: `src/host-record.mjs` (`hostRecord`, `recordInContainer`, command-line guard) and the bin/spotter branch.

## Anchors
- `src/config.mjs:137` normalized backend; `:168-173` backend validation and message.
- `src/config-fields.mjs:14` `web.api` help text.
- `src/backend.mjs:12-51` whole module; `stop` at `:20-28`.
- `src/cli.mjs:32-35` USAGE record; `:54-81` parseArguments; `:269-283` backend start in recordProject.
- `bin/spotter:13-15` build-image block; insert the host branch right after it (before `:16`).
- `test/config.test.mjs:91` message; `:102-104` normalized shape (add `stop: null`); `:116` invalid list (add `{ run: 'x', readyUrl: 'http://x/', stop: ' ' }` and a non-string stop).

## What to keep
- Every existing `startBackend` behaviour and error text (QA-24 tests in `test/backend.test.mjs` must still pass unchanged).
- In-container backend start when `--backend-running` is absent.
- bin/spotter: every other command path byte-for-byte unchanged.

## Required tests
- config: `stop` accepted and normalized; `stop: null` default; invalid `stop` rejected with the new message.
- backend: stop command runs after the group is gone (e.g. stop command records whether the sleeper pid is alive into a file → must be dead); runs on readiness timeout and on startup failure (exit before ready); a failing stop command does not throw; SIGTERM path still exits 143 and the stop command ran.
- host-record (`test/host-record.test.mjs`, temp git repo with one commit; inject `loadConfig` returning `{ name, repo, baseBranch: 'main', web: { api: { backend: {...} } } }` and `record`):
  refuses without `--host-backend`; refuses a config without backend; success: `record` receives `[project, ...flags, '--backend-running']` without `--host-backend`, backend alive during `record`, group gone and stop command ran afterwards, export dir removed, returns `record`'s code; startup failure: rejects with `…; see <logFile>` and `record` never called; SIGINT during `record` (spawn a helper process that calls `hostRecord` with a `record` that never resolves) exits 130 with the group gone and the stop command run.
  `projectDirs` uses `SPOTTER_HOME`; set `process.env.SPOTTER_HOME` to a temp dir **before** importing (dynamic `import()` after setting it), or run in a helper process.

## Verification
- `node --test test/config.test.mjs test/backend.test.mjs test/host-record.test.mjs` (host Node 18).
- `bash -n bin/spotter`.
- Do not run the full suite — `setup` is editing concurrently and you may see unrelated failures. Do not run Docker.

## Report
Write `docs/plans/host-backend-progress/host.md`: files changed, tests and their output counts,
any discrepancy between brief and code, `## Required caller changes` (or None), `## ESCALATIONS`.

## Contracts (frozen, pasted from docs/plans/host-backend-contracts.md)
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


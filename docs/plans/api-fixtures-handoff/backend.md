# Brief: backend (QA-24)

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
- `src/backend.mjs` (new)
- `src/cli.mjs`
- `test/backend.test.mjs` (new)

Concurrently, right now: `replay` edits `src/config.mjs` (it validates and normalizes `web.api.backend`
to `null | { run, readyUrl, timeoutMs }` with `timeoutMs` defaulting to 60000), fixtures and the web stage;
`setup` and `coverage` edit other files. Do not touch any of them. `examples/same-origin-api/server.mjs`
is a coordinator-owned example backend (read-only for you).

## Task
1. C5 `startBackend` in `src/backend.mjs`.
2. C5 CLI wiring in `recordProject` and the USAGE `record` text.

## Anchors
- `src/cli.mjs:31-33` USAGE record text; `:244-272` `recordProject` (export at `:262`, install at `:265-266`,
  `runWebStage` at `:268-269`, outer `finally` removes the export at `:270-272`); `log` at `:49`;
  `toHostPath` imported at `:12`.
- `src/exec.mjs` `runCommand` shows the spawn/env idiom used elsewhere (the backend must not use it:
  it waits for exit).

## Keep
- `spotter run` never starts a backend; only `recordProject` changes.
- Existing record behaviour when `web.api.backend` is null is unchanged.
- **Never import `src/cli.mjs` (or anything importing Playwright) from a unit test**: host Node is 18 and
  Playwright aborts on it, breaking `npm test`. Test `src/backend.mjs` directly; the CLI wiring is verified
  by the coordinator with real `bin/spotter record` runs.

## Required tests (`test/backend.test.mjs`, host Node 18, stdlib only, temp dirs under `os.tmpdir()`)
- ready → `stop()` → the backend's own grandchild process is gone (e.g. run
  `node -e "<http server on port 0 that writes its port and pid to files>"`, or bash that starts a
  background `sleep` and writes `$!`; check with `process.kill(pid, 0)` throwing ESRCH) and the log file exists.
- command that exits 1 before ready → rejects with the exact exited message; no process left.
- readiness timeout (server that never answers 200–399, or nothing listening) with a small `timeoutMs` →
  rejects with the exact not-ready message; the process group is gone.
- interrupted: spawn a helper Node script (written to the temp dir, importing `src/backend.mjs` by absolute
  file URL) that starts a backend and then idles; send the helper SIGTERM; assert it exits with code 143 and
  the backend's grandchild is gone.
- `stop()` twice is harmless.
Keep total test time small (timeouts of a few hundred ms to ~2 s).

## Verification
- `node --test test/backend.test.mjs` (do not run the full suite; others are editing).
- `node --check src/cli.mjs` for syntax (importing it loads Playwright).
- Baseline before your change: `npm test` 86/86.

## Report
Write `docs/plans/api-fixtures-progress/backend.md`, ending with `## ESCALATIONS`.

## Contract (verbatim)

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


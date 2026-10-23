# Brief: surface (wave 2)

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

## Your files (allow-list)
- `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`, `src/dashboard.mjs`
- `src/dashboard/index.html`, `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css` (CSS only if needed)
- `test/cli.test.mjs` (new), `test/dashboard.test.mjs`, `test/report.test.mjs`, `integration/dashboard.test.mjs`

Do not edit `src/levels.mjs`, `src/config.mjs`, `src/completeness.mjs`, `src/config-fields.mjs`
or their tests — the `engine` agent wrote them (landed, verified). Import them as-is. If an
export is missing or behaves differently from the contract, message the coordinator.

## Contracts
Read `docs/plans/testing-levels-contracts.md` **C4–C7** (you implement) and skim **C1/C3**
(the `resolvePlan`, `summarizePlan`, `LEVELS`, `assessCompleteness({ level })` you consume).

## Anchors
- `src/cli.mjs:24` USAGE run line; `:66` `--skip` branch in `parseArguments` (add `--level` beside it);
  `:93` live-auth block in `runCommandLine` (add the two `--level` rejections);
  `:125` start of run setup — resolve the plan before fixtures/run dir; `:132` `createActivity` metadata;
  `:140` `sideArguments` (config → `plan.config`, skip → `runSkip`); `:158` `assessBaseline`;
  `:170-171` `fixtures` / `completeness` in `run` (add `plan`, pass `level: plan.record`);
  `:209` cache key in `loadOrRunBase` (append `-${plan.hash}`; pass the hash in via its arguments).
- `src/report.mjs:138` coverage line — insert the plan line before it.
- `src/htmlReport.mjs:8` `coverage` — unsupported paragraph after the summary `<p>`.
- `src/dashboard.mjs:32` `readRun` (add `plan`, see C6); `:178` POST body parse; `:184` busy check
  (validate level with `resolvePlan` *before* it); `:191` metadata; `:197` launch args; `:243` `/api/projects`
  (add `levels`); add `GET /api/plan` near `/api/projects`, reusing `safeName` and `projectNames()`.
- `src/dashboard/index.html:16-20` start form; `.run-meta` block a few lines below.
- `src/dashboard/dashboard.js:78` `updateBranches`, `:86` project change listener, `:92` POST body,
  `:117-121` refresh rebuilds selects (keep the chosen level), `:138-145` activity page fields.

## Keep
- Same-origin JSON check on POST, `safeName`/branch listing validation, no shell in run control.
- Existing launch args order `['run', project, '--ref', branch]`; `--level` is appended after them.
- `test/dashboard.test.mjs:39` asserts `launched[1].slice(-4)` equals `['run','demo','--ref',branch]` for a
  POST without level — that must still hold. Its mock `loadConfig` returns `{ repo, baseBranch }` only.
- `integration/dashboard.test.mjs:163` expects coverage text starting `INCOMPLETE · baseline none` for a
  project without levels — unchanged behaviour.
- Keyboard operation, visible focus, labels; status understandable without colour; existing element IDs.
- Live auth: no plan resolution (contract C4 literal plan object).

## Required tests
- `test/cli.test.mjs` (new): `parseArguments(['run','demo','--level','low'])` sets `level`; an unknown level throws
  the exact C4 message.
- `test/dashboard.test.mjs` (new test, own server instance with a `loadConfig` that returns a normalized-like
  config with `levels: { default: null, low: { routes: ['home'], specs: null } }`, `checks: []`, `coverage: { required: [] }`,
  `web: null`, `name: 'demo'`): `/api/plan?project=demo&level=low` 200 with summary starting `level low (selected)`;
  `level=bogus` 400; unknown project 404; `/api/projects` includes `levels`; POST with `level: 'low'` launches with
  `[... '--ref', branch, '--level', 'low']`; POST with `level: 'bogus'` 400 and no launch.
  Also: `/api/plan` 400 for `level=low` on the existing mock (no levels) — add to whichever test fits.
- `test/report.test.mjs`: Markdown contains `- plan: ` line before `- coverage:` when `run.plan` is set; HTML lists
  unsupported names when `completeness.level.unsupported` is non-empty.
- `integration/dashboard.test.mjs`: assert `#level` exists with the four options, and `#plan` text starts with
  `Plan: no level` for the test project before starting a run. Do not run it (coordinator runs Docker).

## Verify
`npm test` — the full suite is fine; you are the only agent running. Engine landed with the new
counts recorded in STATE.md; report your before/after counts. Also run
`node src/cli.mjs run demo --level bogus` (expect `spotter: Unknown level "bogus"…`, exit 2) and
`node src/cli.mjs record x --level low` style checks only if they need no Docker/project.

## Report
Write `docs/plans/testing-levels-progress/surface.md`: changes (file:line), test counts, anything
contradicting this brief, anything not verifiable (browser layout), and `## ESCALATIONS`.

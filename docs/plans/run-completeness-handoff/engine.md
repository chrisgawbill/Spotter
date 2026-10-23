# Brief: engine (QA-09 run completeness)

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

## Files you own (allow-list)

- `src/completeness.mjs` (new)
- `test/completeness.test.mjs` (new)
- `src/config.mjs`
- `src/config-fields.mjs`
- `test/config.test.mjs`

Agent `stages` is concurrently editing `src/stages/web.mjs`, `src/stages/specs.mjs` and
their tests. Do not touch those or any other file.

## Contracts

Read `docs/plans/run-completeness-contracts.md` sections **C1, C4, C5, C6, C7** in full;
they are your spec and are short. C2/C3 describe the stage summaries your module reads
(web summary `pagesFailed`, `faultVisitsFailed`, `sessionChecks`; specs summary
`selected`, `flaky`, `completed`). Treat missing new fields as their zero values
(`pagesFailed ?? 0` etc.) so old cached base sides still work.

## Task

1. `src/config.mjs` (C1): validate and normalize `coverage`; validate `expectSelector`
   in `validSession` (`src/config.mjs` near line 76); return `coverage` in the
   normalized object (near line 42). Use `requirableNames` from `src/completeness.mjs`
   for the required-name check (call it on the raw `config` after other checks; it must
   work on the raw YAML shape where routes may be strings and sessions lack anonymous).
2. `src/config-fields.mjs`: add a `coverage` entry (label, type, example, help) in the
   existing style, and mention `expectSelector` in `web.sessions` help/example.
   Do not add `guided: true`.
3. `src/completeness.mjs` (C4–C7): pure functions, JSDoc one-liners, no I/O.
   `assessCompleteness` and `assessBaseline` share one internal `listItems(...)`.
   Items and gaps follow C5/C6 order exactly; strings exactly as written.
4. Tests.

## Keep

- Existing validation messages and normalization (sessions get `anonymous` prepended,
  `faultInjection` defaults). `configHash` behavior unchanged.

## Required tests

`test/completeness.test.mjs`:
- healthy run (checks, rules, web with pages, specs, fixtures) -> complete, gaps [], summary string matches C7 example shape.
- install failed (static summary `[{name:'install',status:'FAIL'}]`, web `'skipped'`) -> checks and web missing with `dependency install failed`, incomplete.
- web build failed -> web missing `build failed`, specs missing `build failed`.
- specs `selected: 0` -> `specs: selected zero tests`.
- specs `completed: false, selected: 3` -> `specs: runner could not complete`.
- session with expectSelector failed 2/4 -> exact C5 reason.
- `--skip static` with a non-required check -> skipped, complete, summary lists `skipped: typecheck (--skip static)`; same check required -> incomplete with `required but skipped`.
- minSpecs above executed -> gap.
- pagesFailed 2 -> `2 of N page visits failed to load` and counts.
- fixtures null with web.api -> fixtures missing.
- liveAuth -> web skipped, no fixtures item, baseline none, pages null.
- assessBaseline: none (no baseSha), same-commit, error, base web skipped while head executed -> failed `base did not run: web`, base specs missing but head executed -> still compared, cached.
- describeFixtures: ageDays floor, sha 7 chars, null.

`test/config.test.mjs`: coverage accepted/normalized defaults; unknown required name,
non-array, `minSpecs` 0 / 1.5 / without specs rejected; required `specs`/session name
accepted when configured; empty `expectSelector` rejected.

## Verify

```bash
cd /home/chris_dev/projects/Spotter
node --check src/completeness.mjs && node --check src/config.mjs
node --test test/completeness.test.mjs test/config.test.mjs
```

Baseline: full `npm test` was 52/52 before you started. Do not run the full suite —
`stages` is editing concurrently; run only your files.

## Report

Write `docs/plans/run-completeness-progress/engine.md`: what you changed, test counts,
`## Required caller changes` (if any), `## ESCALATIONS` (or `None.`).

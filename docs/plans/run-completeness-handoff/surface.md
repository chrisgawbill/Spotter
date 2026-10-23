# Brief: surface (QA-09 run completeness)

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

- `src/cli.mjs`
- `src/report.mjs`, `src/htmlReport.mjs`, `test/report.test.mjs`
- `src/dashboard.mjs`, `src/dashboard/dashboard.js`, `src/dashboard/index.html`,
  `src/dashboard/dashboard.css`, `test/dashboard.test.mjs`, `integration/dashboard.test.mjs`

No other agent is running. Everything else is read-only for you, including
`src/completeness.mjs`, `src/config.mjs`, `src/stages/*`, `src/runner.mjs`, docs.

## Already landed (wave 1, verified) — consume as-is

`src/completeness.mjs` exports (contracts C4–C7, read that file for exact behavior):

```js
requirableNames(config): string[]
describeFixtures(fixtures, now = Date.now()) -> { recordedAt, hash, ref, sha, ageDays } | null
assessBaseline({ config, skip, headStages, baseStages, baseSha, headSha, workingTree, cached, error, liveAuth })
  -> { status: 'compared'|'cached'|'same-commit'|'none'|'failed', reason: string|null }
assessCompleteness({ config, skip, stages, fixtures, baseline, liveAuth, now }) -> Completeness
summarizeCompleteness(completeness) -> string
```

`Completeness = { status: 'complete'|'incomplete', gaps: string[], items: [{ name, kind, required, status, reason }], counts: { pages, faultVisits, specs }, fixtures, baseline, level: null }`.
Stage summaries now carry `pagesFailed`, `faultVisitsFailed`, `sessionChecks` (web) and
`selected`, `flaky`, `completed` (specs). Config carries `coverage`.

## Contract C8 (verbatim)

- `report.json`: `run.completeness` (C4) and `run.fixtures = describeFixtures(fixtures)`.
- Exit codes: `EXIT_INCOMPLETE = 3`. Order: thrown error 2 > incomplete 3 > new
  blocking finding 1 > 0. `activity.finish('incomplete')` for 3.
- `loadOrRunBase` returns `{ side, cached }`; a rejected base becomes
  `{ error }` (no abort). With a failed baseline the comparison treats every head
  finding as new (same as no base).
- Markdown: `RESULT: INCOMPLETE — …` when incomplete (counts text unchanged), then
  `## Incomplete coverage (${gaps.length})` with `- ${gap}` lines; in `## Checks` add
  `- coverage: ${summarizeCompleteness(...)}` as the last check line. A run without
  `completeness` (old reports, tests) renders exactly as today.
- HTML: `<h2>Coverage</h2>` with the summary line, gaps list when incomplete, and an
  items table (name, kind, required yes/no, status, reason), all escaped.
- Dashboard `readRun`: `status = 'incomplete'` when `report.completeness?.status ===
  'incomplete'` (before the fail/pass check; error/stale rules unchanged); adds
  `coverage: summarizeCompleteness(report.completeness)` or null and
  `gaps: report.completeness?.gaps ?? []`.
- Dashboard badge: `incomplete: ['warning', '◐']`, label `INCOMPLETE`.

## Anchors and tasks

1. `src/cli.mjs`
   - USAGE text (line ~24): `exit 1 if anything new is high or medium, 3 if coverage is incomplete, 2 if Spotter itself failed.`
   - `runProject` (~line 120): `basePromise` must not reject: wrap so a thrown base
     becomes `{ error }`. Keep `Promise.all`. `base` is then `{ side, cached }`,
     `{ error }`, or null. Use `side.findings`/`side.screenshotDir` where `base.` is used today.
   - Compute `baseline = assessBaseline({ config, skip: options.skip, headStages: head.stages, baseStages: base?.side?.stages, baseSha, headSha, workingTree: !!options.workingTree, cached: !!base?.cached, error: base?.error, liveAuth: !!options.liveAuth })`.
   - Comparison: only when `base?.side` and baseline status is not `failed`; otherwise
     `{ newFindings: head.findings, existingFindings: [], fixedFindings: [] }`.
     Visual compare: pass `base?.side?.screenshotDir` (keep the same-commit branch).
   - `run.fixtures = describeFixtures(fixtures)`; `run.completeness = assessCompleteness({ config, skip: options.skip, stages: head.stages, fixtures, baseline, liveAuth: !!options.liveAuth })`.
   - Exit: `completeness.status === 'incomplete' ? EXIT_INCOMPLETE : hasFailingFinding(...) ? EXIT_FINDINGS : EXIT_PASS`;
     `activity.finish(exitCode === EXIT_INCOMPLETE ? 'incomplete' : exitCode ? 'fail' : 'pass')`.
   - `loadOrRunBase` (~line 165): return `{ side: cached, cached: true }` / `{ side: base, cached: false }`; cache write unchanged (writes the side only).
   - Log the base error with `log(\`base: failed — ${message}\`)` and an activity event `activity.event('base', 'base run failed', 'done')`.
2. `src/report.mjs`: per C8. The existing web line `fixtures recorded ${recordedAt}`
   stays. Keep "Not checked" behavior. RESULT word: INCOMPLETE > FAIL > PASS.
3. `src/htmlReport.mjs`: Coverage section after the `<pre>` markdown block. Keep script-free.
4. `src/dashboard.mjs` `readRun` (line ~39): per C8; import `summarizeCompleteness`.
5. `src/dashboard/dashboard.js`: add `incomplete` to `statuses` (line 4). In run detail
   (~line 139) show `run.coverage` in a new `<p id="coverage" class="muted">` placed
   in `index.html` inside `.run-meta` after `#updated`; hide it when null. When
   `run.gaps.length`, render them as a list in a new `<ul id="coverage-gaps">` placed
   right after `#run-error` (keep `#run-error` for errors only). Escape all text.
   Check line ~53 (`now(...)`): a finished non-error run already says "Finished"; leave it.
   Status must stay understandable without color (text label + icon already do this).
   Minimal CSS only if the list needs it; use existing tokens/classes.

## Keep

- Exit 2 path unchanged for thrown errors; `--live-auth` forcing `noBaseline`.
- Report rendering for runs without `completeness` (existing tests must pass unchanged).
- Dashboard: functional IDs, escaping, same-origin controls, sandboxed report iframe,
  polling, Tailscale binding. Retention/prune call after the run.

## Required tests

- `test/report.test.mjs`: incomplete run -> `RESULT: INCOMPLETE —`, `## Incomplete coverage (2)` with both gaps, `- coverage: INCOMPLETE ·` line; complete run -> `RESULT: PASS` and `- coverage: COMPLETE`; HTML escapes item reasons and lists gaps.
- `test/dashboard.test.mjs`: a run dir whose `report.json` has `completeness.status: 'incomplete'` -> `/api/runs/...` returns `status: 'incomplete'`, `coverage` string, `gaps`; a complete one keeps pass/fail. Follow the existing test's temp-home setup.
- `integration/dashboard.test.mjs`: seed an incomplete run and assert the badge text `INCOMPLETE`, `#coverage` text and a gap list item are visible on the run page. Follow the existing seeding pattern.
- CLI exit-code logic is exercised by the coordinator's real runs; do not build a CLI harness.

## Verify

```bash
cd /home/chris_dev/projects/Spotter
for f in src/cli.mjs src/report.mjs src/htmlReport.mjs src/dashboard.mjs src/dashboard/dashboard.js; do node --check "$f"; done
npm test
docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/dashboard.test.mjs
```

You are the only agent running, so the full `npm test` is yours to run. Baseline before
wave 2 is in STATE.md.

## Report

Write `docs/plans/run-completeness-progress/surface.md`: changes, test counts,
`## Required caller changes` (if any), `## ESCALATIONS` (or `None.`).

# Brief: dashboard-pdf

Owned files (write only these): `src/dashboard.mjs`, `src/dashboard/index.html`, `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css` (touch only if the button needs it), `test/dashboard.test.mjs`, `integration/dashboard.test.mjs`, `docs/dashboard.md`.
Concurrently, `report-html` is editing `src/htmlReport.mjs`, `src/report.mjs` and `test/report.test.mjs`. Do not touch them.

Your spec: read **"Contract B"** in `docs/plans/report-view-contracts.md`, and only that section plus the Goal.

Anchors: the artifacts route is at `src/dashboard.mjs:310-337` (validation, then `realpath`, then the CSP header at :333); `createDashboardServer` options are at :85; `src/dashboard/index.html:34` holds the report toolbar; `src/dashboard/dashboard.js:196-200` sets `dataset.report`, and `reportUrl` is at :225. Add `pathToFileURL` from `node:url` and `chromium` from `playwright` to the imports.

Keep: the uncommitted user change (run `HOME` = `tmpdir()/home` and its test assertion); all existing artifact confinement checks; the embed regex; element IDs.

Tests:
1. In `test/dashboard.test.mjs`, the unit test (inject `renderPdf: async (file, root) => { calls.push([file, root]); return Buffer.from('%PDF-fake'); }`) must check:
   - a run with `report.html` gives 200, `application/pdf`, the `attachment; filename="spotter-demo-{id}.pdf"` disposition and the body;
   - the renderer received the realpath'd `report.html` and the run root;
   - a run without `report.html` gives 404 and the renderer is not called;
   - `latest` and `..` as id give 404.

   Put this in the existing artifact test or a new small test, whichever fits the file.
2. In `integration/dashboard.test.mjs`, after the healthy run's report is embedded (around line 48-58), click `#download-report` via `Promise.all([page.waitForEvent('download'), page.click('#download-report')])`. Then assert `suggestedFilename()` matches `/^spotter-dashboard-demo-.+\.pdf$/` and that the downloaded file starts with `%PDF`. Use `readFile` (import it if needed).

Verify: run `npm test` (dashboard tests; the full suite is fine, but ignore a `test/report.test.mjs` failure if report-html is mid-edit and say so). Then run the docker integration command from STATE.md and report its exact pass/fail output. If it fails for a reason outside your files, report it rather than fixing it.

Report: `docs/plans/report-view-progress/dashboard-pdf.md` — files changed, tests (counts), integration output tail, `## Required caller changes` (if any), `## ESCALATIONS`.
## Escape hatch

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
  a file you do not own: **ask.** Do not decide it yourself.
- **Already resolved provisionally** — you made a call to keep moving: it still goes in
  `## ESCALATIONS`, even if the tests pass.

A question costs one round trip; a confident wrong guess costs a debugging cycle.

## Ponytail (how to write the code)
Lazy means efficient: reuse existing helpers and patterns in the file, no new
abstractions or dependencies, shortest correct diff, match surrounding style (dense
one-line template literals). Never skip or reshape a contracted item — that is an escalation.

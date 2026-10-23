# Brief: report-html

Owned files (write only these): `src/htmlReport.mjs`, `src/report.mjs`, `test/report.test.mjs`.
Concurrently, `dashboard-pdf` is editing `src/dashboard*`, `test/dashboard.test.mjs`, `integration/`, `docs/dashboard.md`. Do not touch them.

Your spec: read **"Contract A"** in `docs/plans/report-view-contracts.md`, and only that section plus the Goal.

Tasks:
1. `report.mjs`: export `renderPlace`, `renderStageSummary`, `describeCounts`, `describeBase`, `formatDuration`, and add `resultOf(run)`, which `renderMarkdownReport` now uses. Markdown output must stay byte-identical.
2. `htmlReport.mjs`: build the body in the order given in Contract A, together with the CSS described there.
3. Tests in `test/report.test.mjs`: keep every existing assertion passing; update one only when its literal HTML moved, and say which in your report. Add one test that covers:
   - the result banner class and word for PASS, FAIL and INCOMPLETE;
   - a findings row with its `badge sev-high` and escaped title;
   - the `Nothing new.` case;
   - `<h3>` evidence only for groups that have artifacts;
   - the links paragraph still matching the dashboard regex `/<p><a href="report\.md">Markdown<\/a>.*?<\/p>\n?/`.

Keep: script-free output; escaping of every value (the existing XSS test); relative `url()` image links; the `Screenshot`/`Before`/`After`/`Diff` alt text; the `<p>Note: …</p>` and `<h2>Coverage</h2><p>` literals.

Verify: `npm test` (you may run the full suite, which is fast; ignore failures only in `test/dashboard.test.mjs` if dashboard-pdf is mid-edit, and say so). Then render a sample in the image and look at it:
`R=$(readlink -f ~/spotter/triple-crown/runs/latest)` and write a re-render script under the scratchpad
`/tmp/claude-1003/-home-chris-dev-projects-Spotter/ba516e7e-0c22-47e2-ab39-8a47628f94a9/scratchpad/` that imports `renderHtmlReport` and `renderMarkdownReport`, reads `$R/report.json`, and writes `report.html` into a scratch copy of the run directory (copy `screenshots/` and `visual/`). Never write into `~/spotter`. Screenshot it at 1280 and 390 px in the docker image (`/tmp/claude-1003/.../scratchpad/shoot.mjs` exists and shows how; the image's node_modules live at `/opt/spotter/node_modules`, so copy the script under `/opt/spotter/src` inside the container). Save the screenshots as `scratchpad/shots/after-desktop.png` and `after-mobile.png`, plus `after.pdf`. Also check the dark scheme with `colorScheme: 'dark'` → `after-dark.png`.

Report: `docs/plans/report-view-progress/report-html.md` — files changed, tests (counts), screenshot paths, `## ESCALATIONS`.
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

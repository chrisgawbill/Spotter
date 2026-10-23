# Brief: coverage (QA-26 completeness and report)

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
- `src/completeness.mjs`
- `test/completeness.test.mjs`
- `test/report.test.mjs`

Concurrently, right now: `replay` edits config/fixtures/web stage (it produces `stages.web.apiNotReplayed`);
`setup`, `backend` edit other files. Do not touch any of them. `src/report.mjs` must not change.

## Task
1. C4: add the `API traffic not replayed` gap in `assessCompleteness` exactly as written.

## Anchors
- `src/completeness.mjs:96-130` `assessCompleteness`; the page-visit gap is at `:122`, the fault-visit gap at `:123`.
- `test/completeness.test.mjs` helpers `base`, `web`, `stages`, `assess` at the top.
- `test/report.test.mjs` — look at how it builds a `run` object and calls `renderMarkdownReport`.

## Keep
- Every existing gap, item and summary string.
- `stages.web` may be the string `'skipped'`, `undefined`, a summary without `apiNotReplayed`
  (older cached sides), or a live-auth summary: none of these may throw or add a gap.

## Required tests
- completeness: one endpoint → gap exactly `API traffic not replayed: GET /api/items; configure web.api.paths and run spotter record demo`
  and status incomplete; five endpoints → first three then ` and 2 more`; empty array, missing field,
  `'skipped'` web → no such gap; a run without `web.api` in config still gets the gap (detection is independent).
- report: a `run` whose completeness holds that gap renders `RESULT: INCOMPLETE`, the
  `## Incomplete coverage (1)` header and the gap line.

## Verification
- `node --test test/completeness.test.mjs test/report.test.mjs` (do not run the full suite; others are editing).
- Baseline before your change: `npm test` 86/86.

## Report
Write `docs/plans/api-fixtures-progress/coverage.md`, ending with `## ESCALATIONS`.

## Contract (verbatim)

## C4 Completeness (`src/completeness.mjs`, coverage)

In `assessCompleteness`, after the page-visit gap and before the fault-visit gap:

```js
const notReplayed = Array.isArray(stages.web?.apiNotReplayed) ? stages.web.apiNotReplayed : [];
if (notReplayed.length) gaps.push(`API traffic not replayed: ${notReplayed.slice(0, 3).join(', ')}${notReplayed.length > 3 ? ` and ${notReplayed.length - 3} more` : ''}; configure web.api.paths and run spotter record ${config.name}`);
```

No new item, no change to `requirableNames`, `listItems` or `summarizeCompleteness`.
`src/report.mjs` is unchanged: the gap renders under `## Incomplete coverage`.


# Brief: engine (wave 1)

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
- `src/levels.mjs` (new)
- `src/config.mjs`
- `src/completeness.mjs`
- `src/config-fields.mjs`
- `test/levels.test.mjs` (new)
- `test/completeness.test.mjs`
- `test/config.test.mjs`

Do not edit anything else. `src/cli.mjs`, reports and the dashboard belong to the
`surface` agent in the next wave; it will consume your exports exactly as contracted.

## Contracts you implement
Read `docs/plans/testing-levels-contracts.md` sections **C1, C2, C3** — they are the
exact spec (signatures, rules, error messages, summary format). Implement them verbatim.

## Anchors
- `src/config.mjs:86-98` — `coverage` validation; add `problems.push(...levelProblems(config))` next to it.
- `src/config.mjs:101-116` — returned normalized object; add `levels: normalizeLevels(config.levels)`.
  Note `normalizeConfig` validates the *raw* config: `levelProblems` must handle raw `web.routes`
  entries that are strings or `{ name, path }`.
- `src/config-fields.mjs` — add the `levels` entry right after `coverage` (text in C2).
- `src/completeness.mjs:30` `listItems`; `:96` `assessCompleteness` (add `level = null` param, append
  excluded items, drop listItems items whose name matches an exclusion, return `level`);
  `:131` `summarizeCompleteness` (C3 wording).

## Keep
- `requirableNames` and every existing completeness reason string — reports and tests rely on them.
- `resolvePlan` must return the *same config object* when nothing narrows (medium/high/none), so
  existing behaviour and caches are unaffected for projects without levels.
- Never mutate the input config in `resolvePlan`.

## Required tests
`test/levels.test.mjs`:
1. No levels block and no selection → same config object, empty skip, record null.
2. medium selected → record `{ name: 'medium', source: 'selected', exclusions: [], unsupported: [] }`.
3. high → unsupported equals `UNSUPPORTED_AT_HIGH`, config unchanged.
4. `levels.default: low` used when nothing selected (`source: 'default'`); explicit `medium` overrides it.
5. Unknown level throws; low without `levels.low` throws (exact messages).
6. low narrowing on a normalized config (use `normalizeConfig` with checks typecheck/unit/format,
   `coverage.required: [typecheck]`, 3 routes, 2 viewports, 2 schemes, specs, faultInjection default):
   checks = [typecheck]; skip has rules; routes = low routes; 1 viewport; 1 scheme; faultInjection null;
   specs removed; exclusions list names and kinds; input config unchanged.
7. Required items survive low: `required: ['rules', 'specs']` → rules not skipped, specs kept;
   `levels.low.specs.grep` narrows specs and drops `minSpecs` with a `coverage` exclusion.
8. Hash differs between low and medium and is stable for the same input.
9. `summarizePlan` exact string for the low case and for `no level`.
`test/config.test.mjs`: one test covering each `levelProblems` message in C1 and a valid block normalizing.
`test/completeness.test.mjs`: excluded items present, not gaps, status `complete`; `level` returned;
summary contains `level low` and `N excluded by level`; level null keeps the old summary unchanged.

## Verify
`npm test` (full suite is fine: you are the only agent running). Baseline: 71/71 pass. Report the new counts.

## Report
Write `docs/plans/testing-levels-progress/engine.md`: what you changed (file:line), test counts,
anything that contradicts this brief, and `## ESCALATIONS`.

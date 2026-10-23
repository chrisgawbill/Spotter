# Brief: stages (QA-09 run completeness)

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

- `src/stages/web.mjs`
- `src/stages/specs.mjs`
- `test/specs.test.mjs`
- `integration/specs.test.mjs`
- `integration/browser-depth.test.mjs`

Agent `engine` is concurrently editing `src/config.mjs`, `src/config-fields.mjs`,
`src/completeness.mjs` and their tests. Config validation of `expectSelector` is theirs;
you only read `session.expectSelector` (sessions arrive normalized; tests may pass the
field directly). Do not touch any other file.

## Contracts (verbatim from docs/plans/run-completeness-contracts.md)

### C2. Web stage summary (`src/stages/web.mjs`)

Sweep-mode summary gains three fields; everything existing stays:

```js
{
  built: true, pages, shape, faultVisits, sessions, accessibility, keyboard, variantCount, specs?,
  pagesFailed: number,        // healthy visits whose navigation threw (check 'navigation')
  faultVisitsFailed: number,  // fault visits whose navigation threw (check 'fault-navigation')
  sessionChecks: {            // only sessions with expectSelector; {} when none
    [sessionName]: { checked: number, failed: number, examples: string[] /* first 3 `where` strings of failed visits */ }
  },
}
```

Session assertion: for healthy (non-fault) sweep visits of a session with
`expectSelector`, after the page settles, `checked += 1`; if
`await page.locator(expectSelector).count() === 0` then `failed += 1`. A visit whose
navigation threw counts as checked and failed. It does **not** create a finding.
Build-failure and live summaries are unchanged (`{ built: false, pages: 0 }`,
`{ pages: 0, specs }`).

### C3. Specs summary (`src/stages/specs.mjs`)

```js
{ mode: 'replay' | 'live', passed, failed, skipped,     // existing, same meaning
  flaky: number,       // report.stats.flaky ?? 0
  selected: number,    // expected + unexpected + flaky + skipped from report.stats; 0 without a report
  completed: boolean } // report parsed AND not the runner-failure case (exitCode != 0 with no spec findings)
```

## Anchors

- `src/stages/web.mjs:46-65` — `results`/`faultResults` from `runPool`, summary object at line 65.
- `src/stages/web.mjs:118-219` `visitPage`: navigation catch at ~195 reports `navigation` /
  `fault-navigation`; return object at ~204 carries `requests, job, loading, blank, findings`.
  Return the assertion outcome on the visit result (e.g. `sessionCheck: true|false|null`)
  and aggregate in `runWebStage`; the `where` string is already computed (redacted) at line 128.
  Do the locator check in the `mode === 'sweep'` healthy branch, keep it out of record mode.
- `src/stages/specs.mjs:57-59` runner-failure finding and summary line.

## Keep

- All finding titles, keys and severities unchanged (fingerprints must stay stable).
- Secret redaction of `where`; screenshots skipped for storageState sessions.
- Record mode returns `{ findings: [] }` and must not run assertions.

## Required tests

- `test/specs.test.mjs`: unit-test the summary math if you extract it into an exported
  pure helper (e.g. `specSummary(report, exitCode, findings, live)`); otherwise skip.
- `integration/specs.test.mjs`: existing tests assert `selected`/`completed` too; add a
  test where `grep` matches nothing -> `selected === 0`, `completed === false`.
- `integration/browser-depth.test.mjs`: give the `member` session an `expectSelector`
  that matches the healthy page and assert `sessionChecks.member.failed === 0` and
  `checked > 0`; add a second session (or variant) whose selector is absent and assert
  `failed === checked` with `examples` populated, and that no finding was added for it.
  Assert `pagesFailed === 0`.

## Verify

```bash
cd /home/chris_dev/projects/Spotter
node --check src/stages/web.mjs && node --check src/stages/specs.mjs
node --test test/specs.test.mjs
docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/specs.test.mjs
docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" --entrypoint node spotter:latest --test integration/browser-depth.test.mjs
```

Run the two integrations before editing to record their baseline. Do not run the full
`npm test` — `engine` is editing concurrently.

## Report

Write `docs/plans/run-completeness-progress/stages.md`: changes, test results with
counts, `## Required caller changes` (if any), `## ESCALATIONS` (or `None.`).

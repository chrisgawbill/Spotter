# Brief: recovery (wave 1, runs alone)

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

## Ponytail (implementation style, level full)
Understand the flow first, then climb the ladder: does it need to exist → already in this
codebase (reuse `runSpecsStage`, `startStaticServer`, `compareWithBaseline`, the
`examples/journeys` patterns) → stdlib → native platform feature → installed
dependency → one line → only then the minimum code. No new dependencies, no unrequested
abstractions or helpers "for later", fewest lines that stay readable. Ponytail governs
how you write code inside the contract, never whether a contracted item is built; if it
says a contracted item is unnecessary, that is an escalation.

## Goal (ticket QA-11, Spotter side)
Show, with a runnable generic example, how project-owned Playwright specs test recovery
after failure: disconnected requests and reconnect, 401 and 403, 429 with Retry-After,
malformed responses, server errors with Retry, controls leaving their disabled/loading
state, and stale responses arriving after newer requests. Prove that injected failures
create no findings, that seeded defects (permanently disabled control, ineffective Retry,
stale overwrite) each fail their named test and are new against a healthy baseline, and
that the retry window fits a documented budget without leaking between tests.
**No changes to `src/`.**

## Your files (allow-list, all new)
- `examples/recovery/index.html`
- `examples/recovery/scores.journey.mjs`
- `integration/recovery.test.mjs`

Deny-list: everything else. The coordinator edits `src/levels.mjs`, tests, docs, README
and ticket files; no other agent runs. Do not write `docs/plans/fault-recovery.md` or any
other plan file except your report.

## Files to read for conventions
1. `examples/journeys/index.html`, `examples/journeys/items.journey.mjs` (example style; in-spec routing store in `beforeEach`).
2. `integration/journeys.test.mjs` (copy it structurally: temp root, `startStaticServer`, `runSpecsStage`, seeds by exact replacement, `compareWithBaseline`).
3. `src/stages/specsFixture.mjs` (the adapter: sessions, replay, `clock.setFixedTime`). With `fixtures: null` and no `web.api`, no replay route is installed; your `page.route` is the only API.
4. `src/stages/specs.mjs` (`runSpecsStage({ config, workdir, logDir, fixtures, appOrigin })` returns `{ findings, summary: { passed, failed, skipped, selected, completed } }`; finding `title` is `project spec failed: <describe › test name>`).

## Contracts (frozen — pasted from fault-recovery-contracts.md)

## C1. Example app — `examples/recovery/index.html`

Single static file, `<script type="module">`, no dependencies, minimal markup like
`examples/journeys/index.html`. One view:

- Heading `Scores`. A `<select>` labelled `Season` with options `2026` (default) and `2025`.
  A button `Refresh`. A list region (`<ul>` or similar) holding one item per score name.
  A `role="alert"` element for errors (hidden/empty when there is no error), containing
  the message text and, when retrying can help, a button `Retry`.
- `load()` requests `GET api/scores?season=<season>` (relative URL) and expects JSON
  `{ "season": "<season>", "scores": [{ "name": "..." }] }`. It runs on start, on `Refresh`,
  on `Retry`, and on `Season` change.
- While a load is in flight: the list region has `aria-busy="true"` and `Refresh` is
  disabled. After the load settles **in any outcome** (success, HTTP error, network error,
  parse error) `aria-busy` is `false` and `Refresh` is enabled again.
- Only the response to the **latest** request may change the list or the alert
  (request counter or `AbortController`; pick the simplest). A response that arrives after
  a newer request was started is ignored.
- Outcomes (exact alert texts; the list keeps its previous items on error):

| Outcome | Alert text | `Retry` button | Automatic action |
| --- | --- | --- | --- |
| `fetch` rejects (offline / aborted) | `You are offline. Scores reload when the connection returns.` | yes | on the next `window` `online` event, call `load()` once |
| 401 | `Your session has expired. Sign in again.` | no; a button `Sign in` instead, which sends `POST api/session` and then calls `load()` | — |
| 403 | `You do not have access to these scores.` | no | — |
| 429 | `Too many requests. Retrying in <n> s.` (`n` = `Retry-After` seconds, default 1, at most 10) | no | call `load()` once after `n` seconds |
| other non-2xx | `Scores could not load (<status>).` | yes | — |
| 2xx with a body that is not valid JSON | `The server sent an unreadable response.` | yes | — |
| 2xx valid | alert hidden/empty; list replaced with the score names | — | — |

Every statement named in C3 must exist **exactly once** in the file so the seed replacement
is unambiguous.

## C2. Spec — `examples/recovery/scores.journey.mjs`

Imports `{ test, expect }` from `process.env.SPOTTER_TEST_MODULE`. A `beforeEach` installs
`page.route('**/api/**', …)` backed by a per-test object that each test configures:
a queue (or function) deciding the next answer for `GET api/scores`, the count of
`api/scores` requests, and the `POST api/session` handler. Default answer: 200 with
`{ season, scores }` where 2026 → `Alpha`, `Bravo` and 2025 → `Old Alpha`, `Old Bravo`.
The `beforeEach` also collects `page.on('pageerror')`; an `afterEach` asserts the list is
empty (message: `uncaught page errors`), so an unhandled failure fails the named test
while handled, injected failures add nothing.

One named constant documents the retry budget, e.g.
`const RETRY_AFTER_S = 1; const RETRY_BUDGET_MS = RETRY_AFTER_S * 1000 + 3000;`, used as the
`timeout` of the expectation that waits for the automatic 429 retry.

Test names, exactly (findings are keyed by them):

| # | Name | Asserts |
| --- | --- | --- |
| T1 | `Recovery Verify: a dropped connection shows offline, then reloads on reconnect @critical` | initial list loads; set the route store offline flag (route `abort('internetdisconnected')`) **and** `context.setOffline(true)`; click `Refresh` → offline alert, `Refresh` enabled; clear the flag and `context.setOffline(false)` → list loads without a click, alert gone |
| T2 | `Recovery Verify: an expired session asks to sign in and recovers` | first scores answer 401 → session alert with `Sign in`, no `Retry`; next answers 200; click `Sign in` → one `POST api/session`, list loads, alert gone |
| T3 | `Recovery Verify: a forbidden response explains itself without a useless retry` | answer 403 → forbidden alert, no `Retry` button, `Refresh` enabled |
| T4 | `Recovery Verify: a rate-limited load waits for Retry-After, then succeeds` | first answer 429 with `Retry-After: RETRY_AFTER_S` → rate-limit alert; list loads within `RETRY_BUDGET_MS` without a click; exactly 2 scores requests |
| T5 | `Recovery Verify: a malformed response shows an error and Retry recovers @critical` | first answer 200 with body `{"scores": [` → unreadable alert; `Refresh` enabled and list not busy; click `Retry` → list loads, alert gone |
| T6 | `Recovery Verify: a stale response never overwrites a newer one @critical` | hold the `season=2026` start-up answer (unresolved promise); select `2025` → answered at once, list shows `Old Alpha`; release the held 2026 answer, wait for its `requestfinished`, let the page settle (`page.evaluate(() => new Promise((r) => setTimeout(r, 100)))`); list still shows `Old Alpha` and not `Alpha` |
| T7 | `Recovery Verify: a server error offers Retry and Retry recovers` | first answer 500 → `Scores could not load (500).`, click `Retry` → list loads |

7 tests, 3 tagged `@critical`. Comments only where the pattern is not obvious (why routing
lives in the spec; why `pageerror` is asserted; the retry budget).

## C3. Integration — `integration/recovery.test.mjs`

First line: `// Run in the Spotter image: node --test integration/recovery.test.mjs`.
Same structure as `integration/journeys.test.mjs`: `cp` `../examples/recovery` to a temp
root, `startStaticServer(root, '/')`, `runSpecsStage` with `fixtures: null`, sessions
`[{ name: 'anonymous', localStorage: {} }]`, `workers: 2`, a separate `logDir` per run.

```js
// Each seed replaces `from` (present exactly once in index.html) with `to`.
const SEEDS = [
  { name: 'permanently disabled control', test: <T5 name>, from: '<exact>', to: '<...>' }, // Refresh re-enabled only after a successful load
  { name: 'ineffective retry',            test: <T5 name>, from: '<exact>', to: '<...>' }, // Retry hides the alert but does not reload
  { name: 'stale overwrite',              test: <T6 name>, from: '<exact>', to: '<...>' }, // latest-request guard removed
];
```

Tests:

1. `healthy recovery scenarios pass in parallel without injected-error noise` — 7 passed,
   0 findings, `completed === true`.
2. `each seeded defect fails its named scenario and is new against the healthy baseline` —
   for every seed: assert `from` occurs exactly once, write the seeded file, run,
   `compareWithBaseline(seeded.findings, healthy.findings)`; assert a new finding's title
   includes the seed's test name and every new finding has `check === 'project-spec'`.
   Restore the file after each seed. Log the new titles per seed with `console.log`.
3. `the @critical grep selects only critical scenarios` — `grep: '@critical'` → `selected === 3`, 3 passed.

## Points to check empirically (report what you observed)
- Whether Chromium sends routed requests through `page.route` while `context.setOffline(true)` is on. T1 sets both the store flag and offline mode so the result is deterministic either way; say which path actually failed the fetch.
- Whether `context.setOffline(false)` dispatches `online` in the page. If it does not, stop and message the coordinator; do not add a polling fallback on your own.
- That `clock.setFixedTime` leaves `setTimeout` running (T4 depends on it).

## Required checks
- The healthy app passes all 7 tests in Chromium with `workers: 2`, and produces 0 findings.
- Each seed newly fails its named test. Seeds are realistic one-line defects a developer might ship, not `throw`s.

## Verification (you run alone, so the full unit suite is fine)
- `npm test` on host: the count must stay at the baseline the coordinator gave you.
- In Docker, from the repo root:
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" -v "$PWD/examples:/opt/spotter/examples:ro" --entrypoint node spotter:latest --test integration/recovery.test.mjs`
  Then rerun it two more times; report any flakiness (T4 retry window, T6 settle).
- Also run `integration/journeys.test.mjs` and `integration/specs.test.mjs` the same way (regression, should be unaffected).
- Browser claims must come from these Docker runs, not from reasoning. Firefox/WebKit are not required.

Report: `docs/plans/fault-recovery-progress/recovery.md` — files written, run counts per
command (pass/fail, three recovery runs), actual new titles per seed, the empirical points
above, any deviation, then `## Required caller changes` (expect none) and `## ESCALATIONS`.

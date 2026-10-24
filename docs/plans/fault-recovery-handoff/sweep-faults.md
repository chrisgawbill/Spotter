# Brief: sweep-faults (wave 2, runs alone)

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
codebase (the existing fault branch in `replayFixtures`, the fault loop and judging in
`web.mjs`, the levels high union) → stdlib → native platform feature → installed
dependency → one line → only then the minimum code. No new dependencies, no new modules,
no unrequested abstractions or exported helpers. Ponytail governs how you write code
inside the contract, never whether a contracted item is built; if it says a contracted
item is unnecessary, that is an escalation.

## Goal (ticket QA-11, config-only part)
Projects without recovery specs still get recovery-related coverage from config: the
sweep's existing endpoint fault visits (500, delay) gain abort, 401, 403, 429 and
malformed responses. Medium keeps 500/delay; high runs all seven; a project may choose
kinds with `web.faultInjection.kinds`. Judging is unchanged: crash (only when the healthy
visit did not crash the same way), blank, stuck loading. Injected errors never become
API-error findings.

## Your files (allow-list)
- `src/levels.mjs`, `test/levels.test.mjs`
- `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs`
- `src/fixtures.mjs`, `src/stages/web.mjs`
- `integration/browser-depth.test.mjs`
- your report `docs/plans/fault-recovery-progress/sweep-faults.md`

Deny-list: everything else, including `examples/`, `integration/recovery.test.mjs` (wave 1,
done), README and `docs/` (coordinator).

## Already landed in your files (do not revert)
- `src/levels.mjs`: the `{ name: 'recovery scenarios', ticket: 'QA-11', ... }` entry was removed
  from `UNSUPPORTED_AT_HIGH` and the comment above it now reads "Wider coverage high would
  add that is not implemented yet. Listed, never enabled."
- `test/levels.test.mjs:38`: asserts `UNSUPPORTED_AT_HIGH.map((item) => item.ticket)` equals `['QA-13', 'QA-15']`.

## Anchors
- `src/levels.mjs:7` `HIGH_DEVICES`; `:62-66` high branch of `resolvePlan`; `:116-127` `summarizePlan` (` + fault visits` at `:119`).
- `src/config.mjs:83-91` faultInjection validation; `:134` normalization.
- `src/config-fields.mjs:28` `web.faultInjection` field help.
- `src/fixtures.mjs:114-124` fault branch of `replayFixtures`.
- `src/stages/web.mjs:54-60` fault job loop; `:211-213` crash judging; `:230-246` blank/loading judging (unchanged).
- `integration/browser-depth.test.mjs` first test shows how to build a config with `normalizeConfig`, record fixtures with `mode: 'record'` against a tiny API server and run `runWebStage`.

## Contracts (frozen — pasted from fault-recovery-contracts.md)

## C4. Fault kinds — `src/levels.mjs`

Pure constants next to `HIGH_DEVICES` (levels.mjs has no Playwright import; keep it so):

```js
/** Every endpoint fault a sweep can inject. High runs all of them. */
export const FAULT_KINDS = ['500', 'delay', 'abort', '401', '403', '429', 'malformed'];
/** Fault kinds when `web.faultInjection.kinds` is not configured (low skips faults). */
export const DEFAULT_FAULT_KINDS = ['500', 'delay'];
```

`resolvePlan(config, 'high')`: when `config.web.faultInjection` is truthy, the effective
web config gets `faultInjection: { ...config.web.faultInjection, kinds: FAULT_KINDS }`
(alongside the existing browsers/devices union). When it is null, it stays null.
Medium and no-level plans are unchanged (no `kinds` key is added).

`summarizePlan`: the existing ` + fault visits` suffix becomes
` + fault visits (<kinds joined by ', '>)` **only** when `web.faultInjection.kinds` is set
and differs from `DEFAULT_FAULT_KINDS`; otherwise the text is unchanged (existing tests
must keep passing as written).

`UNSUPPORTED_AT_HIGH` no longer has the QA-11 entry (already landed; see STATE).

## C5. Config — `src/config.mjs`, `src/config-fields.mjs`

- Optional `web.faultInjection.kinds`: a nonempty array whose values, after `String(value)`,
  are unique members of `FAULT_KINDS` (YAML `[500, abort]` gives a number; accept it).
  Normalization maps a configured list with `String` so consumers always see strings. Otherwise problem text exactly:
  ``'`web.faultInjection.kinds` must list unique values from 500, delay, abort, 401, 403, 429, malformed'``
  (build the list from `FAULT_KINDS.join(', ')`).
- Normalization does **not** add a default `kinds` (keeps existing config hashes and
  baseline cache keys stable). Consumers use `kinds ?? DEFAULT_FAULT_KINDS`.
- `config-fields.mjs` `web.faultInjection`: example gains the line `    kinds: [500, delay, abort, 429]`; help appends: ` Optional kinds choose faults (500, delay, abort, 401, 403, 429, malformed); default 500 and delay, and level high runs all.`
- `config-fields.mjs` `levels` help (line ~11): replace `high adds Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 for every web project.` with `high adds Chromium, Firefox, WebKit, iPhone 13 and Pixel 7 for every web project, and every fault kind when fault visits are on.`

## C6. Injection — `src/fixtures.mjs` `replayFixtures`, branch `fault?.key === key`

| kind | Response |
| --- | --- |
| `delay` | unchanged |
| `500` | unchanged |
| `abort` | `return route.abort('internetdisconnected')` |
| `401`, `403` | `route.fulfill({ status: Number(kind), headers: { ...cors, 'content-type': 'application/json', 'x-spotter-injected': '1' }, body: '{"error":"Injected failure"}' })` |
| `429` | as 401/403 with status 429 plus header `'retry-after': '1'` |
| `malformed` | `route.fulfill({ status: recorded.status, headers: { ...cors, 'content-type': recorded.contentType ?? 'application/json', 'x-spotter-injected': '1' }, body: '{"injected": "malformed' })` |

Keep it a small switch/ternary inside the existing branch; no new exported helper.

## C7. Sweep — `src/stages/web.mjs`

- Line ~58: `for (const kind of web.faultInjection.kinds ?? DEFAULT_FAULT_KINDS)`.
- Everything else in fault judging is unchanged: crashes are reported only as
  `fault-crash` when the healthy visit did not have the same uncaught error, plus
  `fault-blank` and `fault-loading` (severity `low` for `delay`, `medium` for every other kind).
  Titles keep the form `page crashes during <kind> response`, so each kind has its own
  stable finding key.

## C8. Tests

- `test/levels.test.mjs`: high plan sets `faultInjection.kinds` to `FAULT_KINDS` when fault
  injection is configured and leaves `null` when not; medium plan has no `kinds`;
  `summarizePlan` shows `+ fault visits (500, delay, abort, 401, 403, 429, malformed)` for the
  high plan.
- `test/config.test.mjs`: accepts `kinds: ['abort', 429]` and normalizes it to `['abort', '429']`; rejects `[]`, `['404']`,
  `['500', '500']` and a non-array with the C5 message; normalized config without `kinds`
  has no `kinds` key.
- `integration/browser-depth.test.mjs`: a **new** `test(...)` (leave the existing tests as
  they are): one route, one session, one JSON endpoint, `faultInjection: { kinds: FAULT_KINDS, delayMs: 80, timeoutMs: 400 }`.
  Healthy app: `fetch(...).then((r) => r.ok ? r.json() : Promise.reject(r.status)).then(render).catch(showError)`
  with a visible error text → `faultVisits === 7`, `faultVisitsFailed === 0`, no finding of
  severity above low, and no `api-error`/`unrecorded-request` finding (injected errors are
  not noise). Seeded app: no `.catch`, and `r.json()` called regardless of status, blanking
  the page on start → new `fault-crash` findings for at least `abort` and `malformed`
  against the healthy run (assert titles `page crashes during abort response` and
  `page crashes during malformed response`).

## Points to check empirically (report what you observed)
- Whether an `abort` fault with a `.catch` in the app produces any uncaught error or console noise that becomes a finding (it must not).
- Visit counts: the new integration test's `faultVisits` equals endpoints × 7 for one route and session.

## Verification (you run alone, so the full unit suite is fine)
- `npm test` on host: baseline 160/160 before your change; report the new count (all must pass).
- In Docker, from the repo root:
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" -v "$PWD/examples:/opt/spotter/examples:ro" --entrypoint node spotter:latest --test integration/browser-depth.test.mjs`
  Run it twice. Also run `integration/same-origin-api.test.mjs`, `integration/browser-matrix.test.mjs` and `integration/recovery.test.mjs` the same way (regression).
- Browser claims only from these Docker runs. Firefox/WebKit fault behaviour is not required and stays unverified (faults run only in the first browser).

Report: `docs/plans/fault-recovery-progress/sweep-faults.md` — files changed, test counts
per command, the empirical points, any deviation, then `## Required caller changes`
(e.g. dashboard or report text that should mention kinds; do not edit them) and `## ESCALATIONS`.

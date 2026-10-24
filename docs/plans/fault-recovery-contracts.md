# QA-11 contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

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

---

Added 2026-10-24 after the Product Owner chose config-only sweep fault types
("Add them"). C4–C7 belong to agent `sweep-faults` (wave 2).

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

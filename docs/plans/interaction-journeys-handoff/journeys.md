# Brief: journeys (wave 1, runs alone)

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
`examples/authentication` patterns) → stdlib → native platform feature → installed
dependency → one line → only then the minimum code. No new dependencies, no unrequested
abstractions or helpers "for later", fewest lines that stay readable. Ponytail governs
how you write code inside the contract, never whether a contracted item is built; if it
says a contracted item is unnecessary, that is an escalation.

## Goal (ticket QA-10, Spotter side)
Show, with a runnable generic example, how project-owned Playwright specs test behaviour
after the first render: invalid input then correction and save, duplicate-submit
prevention, edit persistence, filter/pagination URL restoration with back/forward,
dialog keyboard operation with focus restoration, and a role-restricted route. Prove that
seeded defects fail the named tests and are new against a healthy baseline, and that
parallel journeys stay isolated. **No changes to `src/`** — the adapter already does it.

## Your files (allow-list, all new)
- `examples/journeys/index.html`
- `examples/journeys/journeys.spec.mjs`
- `integration/journeys.test.mjs`

Deny-list: everything else. The coordinator edits docs, README and ticket files; no
other agent runs. Do not write `docs/plans/interaction-journeys-progress.md`.

## Files to read for conventions
1. `examples/authentication/index.html`, `examples/authentication/auth.spec.mjs` (example style; in-spec routing).
2. `integration/authentication.test.mjs` lines 1-50 (copy example to temp root, `startStaticServer`, `runSpecsStage`, seed by exact replacement, `compareWithBaseline`).
3. `src/stages/specsFixture.mjs` (the adapter: `spotterSession`, replay, clock). With `fixtures: null` and no `web.api`, no replay route is installed; your `page.route` is the only API.
4. `src/stages/specs.mjs` (`runSpecsStage({ config, workdir, logDir, fixtures, appOrigin })` returns `{ findings, summary: { passed, failed, skipped, selected, completed } }`; finding `title` is `project spec failed: <describe › test name>`).

## Contracts (frozen — pasted from interaction-journeys-contracts.md)

### C1. Example app — `examples/journeys/index.html`
Single static file, `<script type="module">`, no dependencies, minimal markup like the
authentication example. Hash routes:

| Route | Behaviour |
| --- | --- |
| `#/items?q=<text>&page=<n>` (default `#/items`) | Loads `GET api/items` (relative URL). Filter input labelled `Filter`; list filtered by case-insensitive substring of `name`; 2 items per page; buttons `Previous` / `Next`; a `role="status"` line `Page <n> of <m>`. Filter and page are written to the hash query with `history.pushState` (each change is a history entry) and restored from the URL on load and on `popstate`/`hashchange`. Each item links to `#/items/<id>`. A button `Delete…` per item opens C1-dialog. |
| `#/items/<id>` | Edit form: input labelled `Name` (required, at least 3 characters after trim), button `Save`. Invalid submit shows `role="alert"` text `Name must be at least 3 characters` and sends no request. Valid submit: disable `Save` while the request is pending, send `PUT api/items/<id>` with JSON `{ "name": <trimmed value> }`, then show `role="status"` text `Saved`. Loads the current name from `GET api/items/<id>`. |
| `#/admin` | If `localStorage.getItem('role') === 'admin'`: heading `Admin`. Otherwise heading `Not authorized` and no admin content. |

C1-dialog: `Delete…` opens a `div role="dialog" aria-modal="true" aria-labelledby` titled
`Delete <name>?` with buttons `Cancel` and `Delete`. On open, focus moves to `Cancel`;
`Escape` or `Cancel` closes it; on close focus returns to the `Delete…` button that opened
it. (`Delete` may simply close it too; deletion is not part of the journeys.)
Filter input changes may push on `input` or `change`; pick whichever keeps the spec
simple and deterministic, and note it in the report.

Every statement named in C3 must exist **exactly once** in the file so the seed
replacement is unambiguous.

### C2. Spec — `examples/journeys/journeys.spec.mjs`
Imports `{ test, expect }` from `process.env.SPOTTER_TEST_MODULE`. A `beforeEach`
installs `page.route('**/api/items**', …)` backed by a per-test in-memory store
(three items: `{ id: 1, name: 'Alpha' }`, `{ id: 2, name: 'Bravo' }`, `{ id: 3, name: 'Charlie' }`)
that answers `GET api/items`, `GET api/items/<id>`, and `PUT api/items/<id>` (records the
parsed body, updates the store, responds after ~200 ms so a double click lands while
pending). Persistence across `page.reload()` comes from that store. Expose the recorded
writes to tests (e.g. a fixture or a variable set in `beforeEach`) — simplest working way.

Test names, exactly (findings are keyed by them):

| # | Name | Session | Asserts |
| --- | --- | --- | --- |
| T1 | `Journey Verify: invalid name is rejected, then the corrected name saves @critical` | anonymous | `ab` → alert shown, zero writes; `Alpha 2` → one write with body `{ name: 'Alpha 2' }`, `Saved` shown |
| T2 | `Journey Verify: a double-clicked Save sends one write @critical` | anonymous | `dblclick` on Save (or two rapid clicks) → after `Saved`, exactly one PUT recorded |
| T3 | `Journey Verify: an edit persists after reload` | anonymous | save, `page.reload()`, input shows new name; list shows it too |
| T4 | `Journey Verify: filter and page survive reload and back/forward` | anonymous | set filter / page → URL holds them; reload restores input and status; `goBack()`/`goForward()` restore previous/next state |
| T5 | `Journey Verify: the delete dialog works by keyboard and restores focus` | anonymous | focus `Delete…`, press Enter, `Cancel` is focused, `Escape` closes, opener `toBeFocused()` |
| T6 | `Journey Verify: the admin route requires the admin role @critical` | anonymous | `Not authorized` heading, no `Admin` heading |
| T7 | `Journey Verify: an admin can open the admin route` | `admin` via `test.describe` + `test.use({ spotterSession: 'admin' })` | `Admin` heading |

7 tests, 3 tagged `@critical`. Comments only where the pattern is not obvious (e.g. one
line saying routing lives in the spec because the project owns payloads and persistence).

### C3. Integration — `integration/journeys.test.mjs`
First line comment like the matrix test: `// Run in the Spotter image: node --test integration/journeys.test.mjs`.

```js
// Each seed replaces `from` (present exactly once in index.html) with `to`.
const SEEDS = [
  { name: 'broken save',        test: <T1 name>, from: '<exact>', to: '<...>' }, // PUT body ignores the edited value
  { name: 'duplicate write',    test: <T2 name>, from: '<exact>', to: '<...>' }, // Save not disabled / no in-flight guard
  { name: 'lost state',         test: <T4 name>, from: '<exact>', to: '<...>' }, // filter/page not written to the URL
  { name: 'focus restoration',  test: <T5 name>, from: '<exact>', to: '<...>' }, // close does not refocus the opener
  { name: 'unauthorized route', test: <T6 name>, from: '<exact>', to: '<...>' }, // role check removed
];
```

Setup like `integration/authentication.test.mjs`: `cp` `../examples/journeys` to a temp
root, `startStaticServer(root, '/')`, `runSpecsStage` with `fixtures: null`, sessions
`[{ name: 'anonymous', localStorage: {} }, { name: 'admin', localStorage: { role: 'admin' } }]`,
a separate `logDir` per run. Tests:

1. `healthy journeys pass in parallel with isolated state` — `workers: 2`; 7 passed, 0 findings, completed.
2. `each seeded defect fails its named journey and is new against the healthy baseline` —
   for every seed: assert `from` occurs exactly once, write the seeded file, run,
   `compareWithBaseline(seeded.findings, healthy.findings)`; assert a new finding's title
   includes the seed's test name and every new finding has `check === 'project-spec'`.
   Restore the file after each seed. Put the actual new titles per seed in your report.
3. `the @critical grep selects only critical journeys` — `grep: '@critical'` → `selected === 3`, 3 passed.

Use `workers: 2` in every run to keep the file fast. Keep one `try/finally` that closes the
server and removes the temp root.

## Required checks
- The healthy app passes all 7 tests in Chromium; each seed newly fails its named test.
- Seeds are realistic one-line defects (what a developer might really ship), not `throw`s.

## Verification (you run alone, so the full unit suite is fine)
- `npm test` on host: expect 157/157 (your files are not unit tests; the count must not change).
- In Docker, from the repo root:
  `docker run --rm --init --ipc host -v "$PWD/src:/opt/spotter/src:ro" -v "$PWD/integration:/opt/spotter/integration:ro" -v "$PWD/examples:/opt/spotter/examples:ro" --entrypoint node spotter:latest --test integration/journeys.test.mjs`
  Then rerun it two more times; report any flakiness (timing around the 200 ms write delay).
- Also run `integration/specs.test.mjs` and `integration/authentication.test.mjs` the same way (regression, should be unaffected).
- Browser claims must come from these Docker runs, not from reasoning. Firefox/WebKit are not required.

Report: `docs/plans/interaction-journeys-progress/journeys.md` — files written, run
counts per command (pass/fail, three journeys runs), actual new titles per seed, any
deviation, then `## Required caller changes` (expect none) and `## ESCALATIONS`.

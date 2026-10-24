# QA-10 contracts

> These types are decided. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

## C1. Example app — `examples/journeys/index.html`

Single static file, `<script type="module">`, no dependencies, styled like
`examples/authentication/index.html` (minimal markup, no CSS needed). Hash routes:

| Route | Behaviour |
| --- | --- |
| `#/items?q=<text>&page=<n>` (default `#/items`) | Loads `GET api/items` (relative URL). Filter input labelled `Filter`; list filtered by case-insensitive substring of `name`; 2 items per page; buttons `Previous` / `Next`; a `role="status"` line `Page <n> of <m>`. Filter and page are written to the hash query with `history.pushState` (each change is a history entry) and restored from the URL on load and on `popstate`/`hashchange`. Each item links to `#/items/<id>`. A button `Delete…` per item opens C1-dialog. |
| `#/items/<id>` | Edit form: input labelled `Name` (required, at least 3 characters after trim), button `Save`. Invalid submit shows `role="alert"` text `Name must be at least 3 characters` and sends no request. Valid submit: disable `Save` while the request is pending, send `PUT api/items/<id>` with JSON `{ "name": <trimmed value> }`, then show `role="status"` text `Saved`. Loads the current name from `GET api/items/<id>`. |
| `#/admin` | If `localStorage.getItem('role') === 'admin'`: heading `Admin`. Otherwise heading `Not authorized` and no admin content. |

C1-dialog: `Delete…` opens a `div role="dialog" aria-modal="true" aria-labelledby` titled
`Delete <name>?` with buttons `Cancel` and `Delete`. On open, focus moves to `Cancel`;
`Escape` or `Cancel` closes it; on close focus returns to the `Delete…` button that opened
it. (`Delete` may simply close it too; deletion is not part of the journeys.)

Every statement named in C3 must exist **exactly once** in the file so the seed
replacement is unambiguous.

## C2. Spec — `examples/journeys/journeys.spec.mjs`

Imports `{ test, expect }` from `process.env.SPOTTER_TEST_MODULE`. A `beforeEach`
installs `page.route('**/api/items**', …)` backed by a per-test in-memory store
(three items: `{ id: 1, name: 'Alpha' }`, `{ id: 2, name: 'Bravo' }`, `{ id: 3, name: 'Charlie' }`)
that answers `GET api/items`, `GET api/items/<id>`, and `PUT api/items/<id>` (records the
parsed body, updates the store, responds after a short delay of ~200 ms so a double
click lands while pending). Persistence across `page.reload()` comes from that store.

Test names, exactly (findings are keyed by them):

| # | Name | Session | Asserts |
| --- | --- | --- | --- |
| T1 | `Journey Verify: invalid name is rejected, then the corrected name saves @critical` | anonymous | `ab` → alert shown, zero writes; `Alpha 2` → one write with body `{ name: 'Alpha 2' }`, `Saved` shown |
| T2 | `Journey Verify: a double-clicked Save sends one write @critical` | anonymous | `dblclick` on Save (or two rapid clicks) → exactly one PUT recorded |
| T3 | `Journey Verify: an edit persists after reload` | anonymous | save, `page.reload()`, input shows new name; list shows it too |
| T4 | `Journey Verify: filter and page survive reload and back/forward` | anonymous | set filter / page → URL holds them; reload restores input and status; `goBack()`/`goForward()` restore previous/next state |
| T5 | `Journey Verify: the delete dialog works by keyboard and restores focus` | anonymous | open with keyboard (focus `Delete…`, press Enter), focus is on `Cancel`, `Escape` closes, `toBeFocused()` on the opener |
| T6 | `Journey Verify: the admin route requires the admin role @critical` | `anonymous` → `Not authorized`; inside a `test.describe` with `test.use({ spotterSession: 'admin' })` a second test `Journey Verify: an admin can open the admin route` → `Admin` | |

So 7 tests total, 3 tagged `@critical`. Comments only where the pattern is not obvious
(e.g. why routing lives in the spec: projects own payload and persistence semantics).

## C3. Seeds — `integration/journeys.test.mjs`

```js
// Each seed replaces `from` (present exactly once in index.html) with `to`.
const SEEDS = [
  { name: 'broken save',        test: 'T1 name', from: '<exact>', to: '<...>' }, // PUT body ignores the edited value
  { name: 'duplicate write',    test: 'T2 name', from: '<exact>', to: '<...>' }, // Save not disabled / no in-flight guard
  { name: 'lost state',         test: 'T4 name', from: '<exact>', to: '<...>' }, // filter/page not written to the URL
  { name: 'focus restoration',  test: 'T5 name', from: '<exact>', to: '<...>' }, // close does not refocus the opener
  { name: 'unauthorized route', test: 'T6 anonymous name', from: '<exact>', to: '<...>' }, // role check removed
];
```

Tests in the file (same style as `integration/authentication.test.mjs`: `cp` the
example to a temp root, `startStaticServer(root, '/')`, `runSpecsStage` with
`fixtures: null`, sessions `[{ name: 'anonymous', localStorage: {} }, { name: 'admin', localStorage: { role: 'admin' } }]`):

1. `healthy journeys pass in parallel with isolated state` — `workers: 2`; 7 passed, 0 findings.
2. `each seeded defect fails its named journey and is new against the healthy baseline` —
   for every seed: assert `from` occurs once, write the seeded file, run, `compareWithBaseline(seeded, healthy)`;
   assert the seed's test title is among `newFindings` titles and every new finding has
   `check === 'project-spec'`. Restore the file after each seed. Record the actual new
   titles per seed in the report.
3. `the @critical grep selects only critical journeys` — `grep: '@critical'` → `selected === 3`, all pass.

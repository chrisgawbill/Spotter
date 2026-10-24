# journeys report (QA-10, wave 1)

## Files written
- examples/journeys/index.html
- examples/journeys/journeys.spec.mjs
- integration/journeys.test.mjs
- this report. No existing file edited; no `src/` change.

## Results
- `npm test` (host): 157/157 pass.
- Docker journeys integration, 3 runs: 4/4 pass each (parent plus 3 subtests); no flakiness seen (~36 s per run).
- Docker `integration/specs.test.mjs`: 3/3 pass. `integration/authentication.test.mjs`: 2/2 pass.

## New titles per seed (actual, from run 1)
Titles carry a file prefix: `project spec failed: journeys.spec.mjs › <name>`.
- broken save: invalid name is rejected, then the corrected name saves @critical; also "an edit persists after reload" (stale name written, so the stored value never changes)
- duplicate write: a double-clicked Save sends one write @critical
- lost state: filter and page survive reload and back/forward
- focus restoration: the delete dialog works by keyboard and restores focus
- unauthorized route: the admin route requires the admin role @critical

Seeds: `body: JSON.stringify({ name })` -> `{ name: item.name }` (stale value); delete `save.disabled = true;`; pushState target `'#/items' + (qs && '?' + qs)` -> `'#/items'`; delete `opener.focus();` line; role check -> `true`.

## Notes and deviations
- Filter pushes a history entry on `input` (each fill = one entry); page resets to 1 on filter change. Render skips when the hash equals the last rendered one, because popstate and hashchange both fire on traversal.
- Integration is one `test('journeys')` with three `t.test` subtests named per C3 (shared temp root, one try/finally), so the runner reports 4 tests.
- T7 uses an untitled `test.describe(() => ...)` so its title is exactly the contracted name.
- Healthy run asserts 7 passed; grep run asserts selected 3, passed 3.

## Required caller changes
None.

## ESCALATIONS
None.

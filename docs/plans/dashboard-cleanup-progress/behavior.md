# behavior report

Edited only `src/dashboard/dashboard.js`. Brief items 1-12 implemented as specified, in place.

- 1 `statuses` map and new `badge` (with icon, `status status-X` classes).
- 2 `#project-info` fallback text when no project.
- 3 `aria-current="page"` on `nav a.nav-link` at start of `refresh()`, before any await.
- 4 config card/empty state.
- 5 run row (computed `text` once in a map callback, block body).
- 6 project cards plus empty state.
- 7 `is-paused` removed on success, added in catch.
- 8, 9 current/events list markup.
- 10 coverage chip, 11 reuse button class, 12 folder buttons plus `muted` no-subfolders.

Kept: html(), escape on all interpolations, polling guard, editor dirty/stale logic, data-* attributes and link texts.

Verification: `node --input-type=module --check` OK; `npm test` 41/41 pass.
Not verified: any browser behavior (rendering, aria-current, focus). Chromium integration test owed to coordinator.

## ESCALATIONS
None.

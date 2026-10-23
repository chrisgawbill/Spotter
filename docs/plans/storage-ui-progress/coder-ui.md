# coder-ui report

## Files changed
- src/dashboard/index.html: Storage nav link; `#storage-page` (settings card with `#retention-form`, `#keep-runs`, `#keep-baselines`, `#auto-prune`, `#save-retention`, `#retention-message`; Disk usage section with `#refresh-storage`, `#storage-projects` table, `#storage-total`, `#cleanup-now`, `#cleanup-message`). Help paragraphs `#keep-runs-help` etc. are wired with aria-describedby and filled only when locked.
- src/dashboard/dashboard.js: refresh() generalized to runs/configs/storage (title, hidden, aria-current). New loadStorage (hashchange to #storage, initial load, refresh button, after save and cleanup; not on the 2 s poll), size formatter, form fill (skipped while unsaved), locked fields disabled with help text, unsaved tracking disables cleanup with "Save settings before cleaning up.", PUT /api/retention, POST /api/cleanup with confirm. Config logic untouched.
- src/dashboard/dashboard.css: checkbox label, number input width, empty-message hiding, right-aligned numeric cells.
- integration/dashboard.test.mjs: Storage block before the final Runs click (nav aria-current, rows, Tab from nav link reaches #keep-runs, unsaved disables cleanup, save shows "Settings saved.").
- docs/dashboard.md: "## Storage" section before "## Verification".

## Verification
- `node --input-type=module --check < src/dashboard/dashboard.js`: ok
- `node --check integration/dashboard.test.mjs`: ok
- Not run: browser test (Docker), server routes (owned by coder-server). Layout at 375 px, keyboard focus and screenshots unverified.

## Notes
- Sizes: B plain, every larger unit with 1 decimal (brief said "1 decimal above KB"; ambiguous).
- Literal "item(s)" used in all messages per contract.
- Saving sends the effective values of env-locked fields too (contract body has all three), so env values get written to retention.json; they stay overridden by env.
- Storage load errors are shown in `#storage-total`.

## ESCALATIONS
None.

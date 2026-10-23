# coder-prune report

## Files changed
- `src/prune.mjs` (new): exports `DEFAULT_KEEP_RUNS`, `DEFAULT_KEEP_BASELINES`, `retentionSettings`, `isActiveRun`, `pruneProject`, exactly per the contract. Private helpers only otherwise. Stdlib only.
- `test/prune.test.mjs` (new): 5 tests covering all listed cases.

## Verification
- `node --check src/prune.mjs`: ok.
- `node --test test/prune.test.mjs`: 5 tests, 5 pass, 0 fail (Node v18.19.1).
- Full suite not run (per instructions).

## Notes
- Empty-string override is treated as not set (contract: undefined or empty = not set).
- Active-run heartbeat with an unparsable `updatedAt` yields NaN comparison, so false.
- Deletion happens after the full list is built, so `removed` is identical for dryRun.

## ESCALATIONS
None.

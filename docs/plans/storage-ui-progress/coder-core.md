# coder-core report

Files changed: src/prune.mjs, src/cli.mjs, test/prune.test.mjs, README.md.

- prune.mjs: added RETENTION_FILE, third `saved` arg to retentionSettings (overrides > env > saved > defaults;
  invalid saved values throw with the contracted messages), lockedRetention, loadSavedRetention, saveRetention
  (validated, atomic tmp+rename, creates home), directorySize (lstat, no symlink following), storageSummary
  (reuses pruneProject dryRun). Existing exports unchanged.
- cli.mjs: both retentionSettings calls pass `await loadSavedRetention(spotterHome)` (auto-cleanup one inside its try).
- tests: 5 new tests covering the brief's list.
- README: Storage page, retention.json, precedence.

Verification: `node --test test/prune.test.mjs` -> 10 tests, 10 pass. `node --check src/prune.mjs src/cli.mjs` ok.
Not run: full suite, bin/spotter, cli import (Node 18/Playwright).

Note: invalid saved settings are validated even when env/flags override them, so a bad retention.json makes the CLI fail until fixed.

## ESCALATIONS
None.

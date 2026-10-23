# host coder report (QA-27 C1-C4)

## Files changed
- src/config.mjs, src/config-fields.mjs: `stop` key, validation message, `stop: null` default, help text (C1).
- src/backend.mjs: `stop` option; stop command runs in `stop()` after the group is gone, 120 s cap, never throws (C2).
- src/cli.mjs: `--backend-running` flag, skip `startBackend` with log line, USAGE `record` text (C3).
- src/host-record.mjs (new), bin/spotter: `hostRecord`, `recordInContainer`, command-line guard, bin branch (C4).
- test/config.test.mjs, test/backend.test.mjs, test/host-record.test.mjs (new).

## Verification
- `node --test test/config.test.mjs test/backend.test.mjs test/host-record.test.mjs` (Node 18): 23 tests, 23 pass, 0 fail. No stray `sleep 300` processes afterwards.
- `bash -n bin/spotter`: ok.
- Not run: full suite, Docker, a real `bin/spotter record --host-backend` end to end (recordInContainer is untested; tests inject `record`).

## Notes / discrepancies
- `--host-backend` is not parsed by `parseArguments` (host-record strips it; bin/spotter only routes it), so the container CLI rejects it as unknown, as intended.
- The usage-error check in `hostRecord` is only reachable when `--host-backend` is present but the first argument is a flag, e.g. `['--ref', 'x', '--host-backend']` (step 1 runs first per contract).
- On SIGINT/SIGTERM startBackend calls `process.exit`, so the `finally` that removes the export does not run; the dir is removed at the next record start (step 5) or by pruning after a day.
- A stop command killed by a signal is reported as `exited with code null`.

## Required caller changes
None.

## ESCALATIONS
None.

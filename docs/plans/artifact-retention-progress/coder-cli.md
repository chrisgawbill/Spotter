# coder-cli report

## Files changed
- src/cli.mjs: `prune` in USAGE; parseArguments (positional project only if argv[1] does not start with `--`; `--dry-run`, `--keep-runs`, `--keep-baselines`); `pruneCommand` (handled before run/record check; unknown project throws `Unknown project "<name>"`; per-path, per-skipped and total lines; EXIT_PASS); auto cleanup in runProject after `activity.finish` and before `return exitCode`, fully in try/catch (logs `pruned <n> old item(s)` or `retention skipped: <message>` via the stderr `log`); `utimes` on baseline cache hit.
- bin/spotter: `-e SPOTTER_KEEP_RUNS -e SPOTTER_KEEP_BASELINES -e SPOTTER_AUTO_PRUNE` on the final docker run.
- README.md: prune example in command block, `## Disk usage` section.
- docs/self-hosting.md: retention sentence with link to README section.
- examples/deploy/spotter-dashboard.service: three commented Environment lines.

## Verification
- `node --check src/cli.mjs`: ok. `bash -n bin/spotter`: ok.
- `npm test`: 41 tests, 41 pass, 0 fail (src/prune.mjs exists; no prune test file seen yet, so count is still 41).
- Parse check NOT run: importing cli.mjs fails on host Node 18.19.1 ("Playwright requires Node.js 20 or higher"), an existing limitation, not caused by this change.
- Not run: bin/spotter, real run or prune (would touch ~/spotter). Behavior of pruneCommand and the run-time cleanup is unexercised end to end.

## Notes
- Prune output and the "pruned n" message: prune lines use console.log (stdout) per contract; the auto-cleanup messages use the existing stderr `log` helper ("[spotter] ..."), since stdout of `run` is the report.

## ESCALATIONS
None.

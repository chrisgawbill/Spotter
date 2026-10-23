# backend (QA-24) report

Done: C5 `startBackend` in `src/backend.mjs`; `recordProject` wiring and USAGE text in `src/cli.mjs`; `test/backend.test.mjs` (5 tests).

Verification: `node --check src/cli.mjs` ok; `node --test test/backend.test.mjs` 5/5 pass (~2.5 s). Full suite not run (others editing). CLI wiring not exercised by a real `bin/spotter record` (owed to coordinator).

Notes
- The backend start/stop sits inside the existing outer try/finally; an inner try/finally stops the backend after `runWebStage` and the built check.
- `stop()` sends SIGKILL to the group after the child exits too (not only on the 5 s timeout), so grandchildren that outlived the shell or ignored SIGTERM are not left behind. ESRCH ignored.
- The 5 s wait timer is unref'd so it does not hold the process open.
- Readiness polls use `redirect: 'manual'` so a 3xx counts as ready.
- Tests: tests cover ready/stop (grandchild gone, log exists), stop twice, early exit message, timeout message + group gone, SIGTERM helper exit 143 + grandchild gone. SIGINT (130) not separately tested.

## ESCALATIONS
None.

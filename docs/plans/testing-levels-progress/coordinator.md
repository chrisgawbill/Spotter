# QA-08 testing levels — coordinator progress

| Wave | Agent | Status |
| --- | --- | --- |
| 1 | engine | Landed, independently verified (83/83 after coordinator fix) |
| 2 | surface | Landed, independently verified (85/85 after coordinator fix) |

Coordinator interventions:
- Completeness exclusions now match name AND kind (a route named like a stage/check hid it); regression test added; contract C3 updated.
- Removed `test/cli.test.mjs`: importing `src/cli.mjs` loads Playwright, which aborts on the host's Node 18 and broke `npm test`. The error text is covered by `resolvePlan` tests; the CLI path was exercised by real runs.
- Docs (README, dashboard, ticket index, evidence) written by the coordinator.

No outstanding caller integrations. Unverified items are listed in docs/ticket-evidence.md#qa-08.

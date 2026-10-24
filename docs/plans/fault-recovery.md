# QA-11 fault recovery and response ordering — plan

Started by the Product Owner 2026-10-24 ("Use /ponytail and /handoff for QA-11").
Coordinator decisions below are provisional until the Product Owner accepts a sample report.

## Findings against the code (2026-10-24)

| Ticket need | Already provided by | Where |
| --- | --- | --- |
| Project-owned scenarios, per-test isolation, parallel workers | spec adapter, Playwright per-test contexts | `src/stages/specsFixture.mjs:10-31`, `src/stages/specs.mjs:14` |
| Disconnects, 401/403, 429, malformed bodies, delayed/out-of-order replies | `page.route` (`abort`, `fulfill` with any status/body, held fulfil) and `context.setOffline`; page routes take precedence over replay | pattern in `examples/journeys/items.journey.mjs`, `src/fixtures.mjs` replay |
| Real retry windows under the frozen clock | `context.clock.setFixedTime` fixes `Date` only; timers keep running | `src/stages/specsFixture.mjs:22` |
| Injected failures do not become findings | spec stage reports only failed tests, keyed by name + project | `src/stages/specs.mjs:76-91` |
| Unexpected failures still fail | the example fails a test on any uncaught page error (`pageerror`) | new, in the example spec |
| Sweep-level initial failure state | `web.faultInjection` 500/delay visits; crashes counted only when the healthy visit did not crash | `src/stages/web.mjs:53-63,212-243` (unchanged) |
| Bounded sets by level | `levels.low.specs.grep`; medium/high run all configured specs | `src/levels.mjs:105-115` |
| High lists recovery as unsupported | `UNSUPPORTED_AT_HIGH` entry for QA-11 | `src/levels.mjs:12`, `test/levels.test.mjs:38`, `README.md:123` |

Conclusion: like QA-10, recovery assertions are delivered as a runnable generic example, a
seeded-defect integration test and documentation, and the QA-11 entry leaves
`UNSUPPORTED_AT_HIGH`. Product Owner addition (2026-10-24, "Add them"): projects without
recovery specs still get config-only coverage, by extending the sweep's 500/delay fault
visits with abort, 401, 403, 429 and malformed responses (initial failure state only:
crash, blank, stuck loading; proving recovery still needs a spec).

## Decisions

| Question | Decision |
| --- | --- |
| Shared fault machinery | None. Plain `page.route` / `context.setOffline` in project specs (ticket: "reuse Playwright routing before adding shared fixture machinery"). |
| Example | `examples/recovery/index.html` (tiny vanilla app, one scores list) + `examples/recovery/scores.journey.mjs`. Not a reusable implementation. |
| Injected vs unexpected | Injected HTTP/network failures are handled by the app and never produce findings. The spec fails a test on any uncaught page error, so an unhandled failure is a named failure. |
| Retry windows | The app honours `Retry-After`; the spec's wait budget is the documented window plus a margin, written as a named constant. Each test has its own context and route store, so nothing leaks. |
| Sweep fault kinds | `web.faultInjection.kinds` (optional). Default `500`, `delay` (medium unchanged, no baseline-cache churn); high runs all seven; low still skips fault visits. |
| Levels | Recovery scenarios are ordinary specs. Tag the one or two that low should run `@critical`; medium and high run all. No new level config. `UNSUPPORTED_AT_HIGH` drops the QA-11 entry. |
| Seeded defects | Integration test applies one exact-string replacement to `index.html` per seed: permanently disabled control, ineffective Retry, stale overwrite. |
| Consumer adoption | Separate step in a consumer repository, pending Product Owner direction. |

## Ownership and waves

| Wave | Agent | Files |
| --- | --- | --- |
| 1 | recovery | `examples/recovery/index.html`, `examples/recovery/scores.journey.mjs`, `integration/recovery.test.mjs` (all new) |
| 2 | sweep-faults | `src/levels.mjs`, `test/levels.test.mjs`, `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs`, `src/fixtures.mjs`, `src/stages/web.mjs`, `integration/browser-depth.test.mjs` |
| — | coordinator | `README.md`, `docs/project-specs.md`, `docs/ticket-index.md`, `docs/ticket-evidence.md`, `docs/plans/fault-recovery*`, verification |

Wave 1 is one agent: the app, its spec and the seed replacements are coupled by exact
strings. Wave 2 runs after wave 1 because its `src/` edits would disturb wave 1's Docker runs,
which mount `src/`. The coordinator's one-line `src/levels.mjs` edit (drop QA-11 from
`UNSUPPORTED_AT_HIGH`) landed before wave 2 and passes to the wave-2 owner.

Contracts: [fault-recovery-contracts.md](fault-recovery-contracts.md).

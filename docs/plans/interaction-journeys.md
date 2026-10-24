# QA-10 critical interaction journeys — plan

Started by the Product Owner 2026-10-23 ("Use /ponytail and /handoff for QA-10").
Coordinator decisions below are provisional until the Product Owner accepts a sample report.

## Findings against the code (2026-10-23)

| Ticket need | Already provided by | Where |
| --- | --- | --- |
| Project-owned specs, deterministic replay, fixed clock | spec adapter | `src/stages/specsFixture.mjs:10-31` |
| Isolated contexts, parallel journeys | Playwright per-test contexts, `web.specs.workers` | `src/stages/specs.mjs:14`, `integration/specs.test.mjs` (two-worker test) |
| Role-specific sessions | `test.use({ spotterSession })` | `src/stages/specsFixture.mjs:16-19` |
| Explicit response sequences and write assertions | `page.route`/`context.route` in the spec; recorded replay routes only matched method+URL | `src/fixtures.mjs:99-131`; pattern in `examples/authentication/auth.spec.mjs` |
| Stable failure identity vs baseline | spec findings keyed by test name + project | `src/stages/specs.mjs:79-90`, `compareWithBaseline` `src/findings.mjs:63` |
| Critical set at low, broader at medium/high | `levels.low.specs.grep`; medium/high run all configured specs | `src/levels.mjs:107-115` |

Conclusion: QA-10 needs **no change in `src/`**. The ticket is delivered as a runnable
generic example, a seeded-defect integration test and documentation, matching how
QA-07 delivered `examples/authentication`.

## Decisions

| Question | Decision |
| --- | --- |
| Journey language | None. Plain Playwright specs through `SPOTTER_TEST_MODULE`. |
| Example | `examples/journeys/index.html` (tiny vanilla app, hash routes) + `examples/journeys/journeys.spec.mjs`. Not a reusable implementation. |
| Writes / persistence | The spec owns an in-test server (`page.route('**/api/**')`) holding item state for that test only; it records write payloads and counts. |
| Dialog | Custom `role="dialog"` element with explicit focus management (native `<dialog>` restores focus by itself, which would hide a seeded defect). |
| Roles | Sessions `anonymous` and `admin` (localStorage `role: admin`); `#/admin` shows "Not authorized" without the role. |
| Levels | Critical journeys carry `@critical` in their names; projects set `levels.low.specs.grep: '@critical'`. No new level config: medium and high run every configured spec. |
| Seeded defects | Integration test applies one exact-string replacement to `index.html` per seed and checks the named test is new against the healthy run. |
| Consumer adoption | Separate step in HockeyStatsWebApp, pending Product Owner direction (other repository). |
| Non-invasive (Product Owner, 2026-10-24) | Adoption only adds `*.journey.mjs` files. Vitest/Jest never collect that name by default, so project configs stay untouched. Setup inference accepts `.journey.` alongside `.spec.`/`.test.`. The example is renamed `items.journey.mjs`. |

## Ownership and waves

| Wave | Agent | Files |
| --- | --- | --- |
| 1 | journeys | `examples/journeys/index.html`, `examples/journeys/journeys.spec.mjs`, `integration/journeys.test.mjs` (all new) |
| — | coordinator | `docs/project-specs.md`, `README.md`, `docs/ticket-index.md`, `docs/ticket-evidence.md`, `docs/plans/interaction-journeys*`, verification |

One agent: the app, its spec and the seed replacements are coupled by exact strings, so
splitting them would only add a contract round trip.

Contracts: [interaction-journeys-contracts.md](interaction-journeys-contracts.md).

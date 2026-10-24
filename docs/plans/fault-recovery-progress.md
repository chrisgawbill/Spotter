# QA-11 progress (coordinator-owned)

## Waves

| Wave | Agent | Status | Report |
| --- | --- | --- | --- |
| 1 | recovery | Done, coordinator re-verified | [recovery.md](fault-recovery-progress/recovery.md) |
| 2 | sweep-faults | Done, coordinator re-verified | [sweep-faults.md](fault-recovery-progress/sweep-faults.md) |

Ownership held: each agent wrote only its allow-list (checked with `git status`).
Neither agent escalated; both reported no required caller changes.

## Coordinator interventions

- Product Owner question mid-wave 1 ("what can it do if there is no logic?"): spec-only
  recovery gives nothing to projects without specs. The Product Owner chose to add
  config-only sweep fault kinds; contracts C4–C8 and wave 2 followed.
- `integration/recovery.test.mjs`: runs now pass `fixtures: { recordedAt, entries: {} }`.
  Wave 1 ran with `fixtures: null`, which never froze `Date`, so the 429 retry under the
  frozen clock was unproven. It passes under the frozen clock.
- `src/fixtures.mjs`: `fault.kind === '500' ? 500 : Number(fault.kind)` → `Number(fault.kind)`.
- `src/levels.mjs`: the QA-11 `UNSUPPORTED_AT_HIGH` entry was removed before wave 2.
- Docs: README high row, `docs/project-specs.md` "Recovery scenarios",
  `docs/browser-checks.md` fault kinds, ticket index status ACTIVE (ready for review).

## Follow-up: setup inference (2026-10-24)

Product Owner asked for the config wizard to detect fault kinds and for every config to be
updated. Implemented directly by the coordinator (about 25 lines in `src/route-discovery.mjs`,
`src/project-options.mjs`, `src/config-drift.mjs` plus tests; too small to split). Configs under
`projects/` (local, not in Git) updated with the inferred kinds.

## Verification

See [ticket evidence](../ticket-evidence.md#qa-11).

## Open

- Accepted by the Product Owner 2026-10-24.
- Consumer adoption (a recovery journey in HockeyStatsWebApp or Triple Crown), pending direction.
- Firefox/WebKit: recovery example and fault kinds verified in Chromium only (faults run in the
  first browser only by design).
- Pre-existing, unrelated: `integration/visual.test.mjs` fails on unchanged `HEAD` too
  (`renderHtmlReport` reads `stages` of undefined; the test passes an outdated argument shape).
- Seeded scratch clone `/tmp/spotter-depth-seeded` predates HockeyStats' spec files, so its run is
  INCOMPLETE ("specs: selected zero tests"); refresh the clone onto current main to clear that.

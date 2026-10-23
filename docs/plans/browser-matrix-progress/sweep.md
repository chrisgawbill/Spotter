# sweep report (C6-C8)

## Done
- `src/stages/web.mjs`: targets via `listTargets`; devices resolved before the build; `launchBrowsers` (exported, closes launched browsers on failure, C6 message) and `deviceOptions` (exported, C6 message); one browser per engine, all closed in `finally`; jobs carry `target` (device viewport for devices); identity suffixes/keys per C6 (`api-not-replayed` sets `browser: undefined`); faults, axe and keyboard primary-only; record launches/visits the primary only; summary `shape` suffix and `targets`; passes `projects` (full `devices[name]` descriptor for devices, `{ browserName }` for browsers) to `runSpecsStage` when not the default matrix. Job order for the default matrix is unchanged (route, viewport, scheme, session).
- `src/stages/specs.mjs`: `projects = null` written verbatim into the generated config when non-empty and not live. No playwright import.
- `src/config-drift.mjs`: variant key includes `job.target?.id`.
- Tests: `test/config-drift.test.mjs` (+1), `integration/browser-matrix.test.mjs` (4 tests: matrix run, launch failure, unknown device before build, legacy names).

## Verification
- Host: `node --test test/config-drift.test.mjs test/specs.test.mjs` 8/8 pass (run before the new drift test was counted separately; the added test is included in the final file and passes in that command).
- Docker (spotter:latest): browser-matrix + browser-depth + specs integration, 10/10 pass. This run is the evidence for Firefox, WebKit and iPhone 13 emulation: 4 pages, 4 distinct screenshots, 4 spec projects, Firefox-only defect yields new findings only on `... firefox` plus the firefox spec failure.
- Full unit suite not run (engine editing concurrently).

## Notes
- Legacy screenshot name for route `/` is `-375-light-anonymous.png` (empty route name), as before; asserted in the test.
- Chromium-in-a-non-default-matrix keeps no suffix (per C6), so its names equal legacy.

## Required caller changes
None.

## ESCALATIONS
None.

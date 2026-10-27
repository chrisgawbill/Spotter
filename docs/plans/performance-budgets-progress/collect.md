# collect (QA-15 wave 2) report

## Done
1. `src/config.mjs`: `performanceProblems(config.web)` in problems; `performance: normalizePerformance(web.performance)` in `normalizeWebConfig` (null when absent). `configHash` is from the YAML source, so it is unchanged; `plan.hash` changes once.
2. `src/config-fields.mjs`: `web.performance` entry after `web.faultInjection`... placed before `web.colorSchemeStorage` (directly after faultInjection).
3. `src/levels.mjs`: QA-15 removed from `UNSUPPORTED_AT_HIGH`; low nulls `web.performance` with exclusion (only when configured); non-high/non-low strips `timings`, medium adds the exclusion; `summarizePlan` line.
4. `src/stages/specsFixture.mjs`: `spotterTiming` per C4.
5. `src/stages/specs.mjs`: internal `runSpecs(opts, { dirName, repeatEach, workers, grep })`; `runSpecsStage` unchanged in shape; exported `runTimedSpecs` (logs in `logs/specs-timing/`, `error: 'no spotterTiming samples'`, never throws).
6. `src/stages/web.mjs` (sweep + `web.performance` only): `measureBuild` after build; per-route traffic counting in `visitPage` on the primary job per route (first target, first viewport, first scheme, anonymous), body reads `.catch`ed, frozen after settle, dropped if the visit failed before settling; `sampleTimings` / `samplePageLoad` last; `summary.performance`; `absoluteBudgetFindings` appended. No extra work without `web.performance`.
7. `src/runner.mjs`: `timingGate` passed to `runWebStage`, `timingGate?.done()` in `finally`.

## Tests
- `npm test`: 186/186 (182 baseline + 3 levels + 1 config).
- Docker integration (command from STATE.md), each passing: browser-depth 5/5, specs 3/3, journeys 4/4, recovery 4/4, browser-matrix 4/4. Run twice (before and after the coordinator-approved change below).
- Throwaway check (files only under the scratchpad `collect/` dir, mounted at /work): `runWebStage` on a tiny app with api replay, specs and C1-like config. Saw `summary.performance` with 6 build metrics, `route.home.{requests 4, apiRequests 1, bytes 352, imageBytes 100}`, `timing.home.load` (3 samples, ~19 ms), `interaction.open dialog` (6 samples: 2 fixture calls x 3 repeats), environment `chromium 156.0.8078.4`, 16 cpus, replayed, 3; absolute-budget finding `build.total is 335 B (max 10 B)` flowed through findings; `timingError` null. Without `web.performance`, the `performance` key is absent from the summary. With empty fixtures, page-load sampling gave `timingError: "page-load sampling requested unrecorded API data without the frozen clock (GET /data)"` and no `timing.home.load` metric. Attachments were read from the real JSON report (`results[].attachments[].body` base64), confirming the brief's shape.
- Not unit tested (Playwright code): the above Docker check is the only coverage for `sampleTimings`, `samplePageLoad`, traffic counting and `runTimedSpecs`. Gate interplay across two sides with `createTimingGate` is unverified here (single-side gate only).

## Required caller changes
None in files I do not own. cli must create `createTimingGate(2)` sides and pass `timingGate` to both `runSide` calls (wave 4).

## ESCALATIONS
- Frozen clock in page-load sampling (C2): under `clock.setFixedTime` Chromium returns no navigation timing entries (verified in Docker), so `samplePageLoad` does not freeze the clock. Resolved by the coordinator: it passes `onUnrecorded` to `replayFixtures`; any unrecorded key sets `timingError` to `page-load sampling requested unrecorded API data without the frozen clock (<first key>)` and drops that route's timing metric. Coordinator will update contract C2. Only verified on Chromium; Firefox/WebKit navigation timing under the freeze was not checked (the freeze is skipped for all engines).
- Minor choices (not blocking): on a thrown sampling error, partial timings already collected are kept (timingError set); `timings`/`environment` are null when no metric was produced. Route requests count http(s) requests of all origins; the fixture's raw (unrounded) interaction samples are stored as `samples`.

# example (QA-15 wave 3) report

## Files
- `examples/performance/index.html`, `app.js`, `details.journey.mjs` (new)
- `integration/performance.test.mjs` (new)

## Docker commands (run from the repo root)
```
D="docker run --rm --init --ipc host -v $PWD/src:/opt/spotter/src:ro -v $PWD/integration:/opt/spotter/integration:ro -v $PWD/examples:/opt/spotter/examples:ro --entrypoint node spotter:latest"
$D --test integration/performance.test.mjs   # run twice
$D --test integration/journeys.test.mjs  # also recovery, specs
```

## Results
- performance: run 1 and run 2 both 6/6 pass (1 top test + 5 subtests), 62.2 s and 62.7 s.
- journeys 4/4 (35.9 s), recovery 4/4 (32.6 s), specs 3/3 (4.5 s).

## Healthy numbers (identical resources in all runs)
resources: build.js 1189, build.other 222, build.total 1411, route.home.requests 3, apiRequests 1, bytes 1906, imageBytes 0.
Timings (ms, median / min / max of 5):
- Run 1 side A: load 15.8 / 13.9 / 17.3; open details 42.5 / 38.6 / 51.6. Side B: load 15.7 / 14.2 / 17.7; open details 46.7 / 39.4 / 52.9.
- Run 2 side A: load 15.5 / 14.2 / 17.9; open details 43.7 / 38.7 / 46.6. Side B: load 15.1 / 14.4 / 24.9; open details 49.4 / 39.5 / 50.7.
No relative finding in either direction, no absolute finding, `notCompared` empty, environment.api `replayed`, `timingError` null.

## Seeds (same in both runs)
- bundle growth: new = `build.js` only (low), 1.2 kB to 151.9 kB (build.js 151,865 B / 151,857 B; route bytes also rose, no budget).
- request multiplication: new = `route.home.apiRequests` (low, 5 vs max 1) and `route.home.requests` (medium, 3 to 7); build.js 1193.
- slow interaction: new = `interaction.open details` only (low), 43 ms to 450.5 ms (min 440-441, max 457); `timing.home.load` unflagged (14.4-14.6 ms).
- Gate: 12 turns (5 loads + 1 interaction run per side) never overlap; a gate of 2 with one side calling `done()` without arriving lets the other finish. Not configured: `summary.performance` undefined.

## Notes and discrepancies
- The first app version had a 264 B gzipped bundle; the slow-interaction seed's loop added 34 B (13%) and tripped `build.js` (10%). I added a fixed 1 kB filler constant (`existing`, in `app.js`, commented) so the healthy bundle is 1189 B and the loop is under 3%. No thresholds changed.
- The seeded busy loop uses `performance.now()`: `Date` is frozen in specs (`recordedAt`), which would hang a `Date.now()` loop.
- The seeded `to` for the bundle is generated per test run with `crypto.randomBytes`; the healthy app is unchanged between runs.
- Interaction healthy samples vary (min 23-39 ms in the first, un-padded runs); the noise rule (head min > base max) kept all healthy comparisons clean in 4 healthy-vs-healthy comparisons across 2 runs plus 6 gated/seeded runs. Not stress-tested beyond that.
- Docker test output does not show `ℹ` for the nested count of the top-level test; counts above come from the TAP summary.

## ESCALATIONS
None.

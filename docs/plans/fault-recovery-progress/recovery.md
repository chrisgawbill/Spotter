# recovery report (QA-11 wave 1)

## Files written
- examples/recovery/index.html (C1)
- examples/recovery/scores.journey.mjs (C2; 7 tests, 3 @critical, exact names)
- integration/recovery.test.mjs (C3)

## Runs (Docker, spotter:latest, Chromium)
- recovery x3: 4 pass / 0 fail each run (suite + 3 subtests); no flakiness seen in T4 or T6.
- journeys: 4 pass / 0 fail. specs: 3 pass / 0 fail.
- host `npm test`: 160/160 (the working tree also has the coordinator's edits).

## New titles per seed (identical in all 3 runs)
- permanently disabled control (`refresh.disabled = false;` -> `if (names) refresh.disabled = false;`): T1 dropped connection, T3 forbidden, T5 malformed.
- ineffective retry (`button('Retry', load)` -> `button('Retry', () => { error.hidden = true; })`): T5 malformed, T7 server error.
- stale overwrite (`if (request !== latest) return;` -> empty): T6 stale only.
All titles are `project spec failed: scores.journey.mjs › <test name>`, check `project-spec`.

## Empirical points (probe script in /tmp, Chromium in the image)
- A routed request is fulfilled by `page.route` even while `context.setOffline(true)` is on (fetch resolved). So the store flag (`abort('internetdisconnected')`) is the path that fails the fetch in T1; setOffline only matters for the `online` event.
- `context.setOffline(false)` does dispatch `online` in the page (observed 1 event); no polling fallback needed.
- `clock.setFixedTime` is called by the adapter only when `fixtures.recordedAt` is set; with `fixtures: null` it is never called here, so T4 does not exercise it. Not verified with a fixed clock; per Playwright semantics timers keep running, but not observed.

## Deviations / notes
- App has a `parse` helper and `const names = response?.ok && parse(text)` so that the "disabled control" seed is a realistic one-line defect that T5 can catch (a 200 malformed body); the first design (gating on `response.ok`) did not fail T5.
- 429 timer is not cancelled if a newer load starts; acceptable per contract ("call load() once after n seconds").
- Seed "permanently disabled control" also newly fails T1 and T3 (Refresh stays disabled after those errors); contract only requires the named test among the new ones.
- Firefox/WebKit not run.

## Required caller changes
None.

## ESCALATIONS
None.

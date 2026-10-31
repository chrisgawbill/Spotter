# Project specs and API contracts

Keep specs in the project repository, relative to `workdir`. Name tests after
the ticket and its Verify item so failures map directly to acceptance criteria:

```js
const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

test('TICKET-12 Verify 1: standings are visible', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Standings' })).toBeVisible();
});
```

Enable them with `web.specs.files` in the project YAML. Optional `grep` selects
test names using a regular expression. Optional `matrixGrep` selects the
smaller subset that runs in secondary browsers and devices at level high; the
full suite still runs in the primary browser. Set `web.specs.workers: 2` to run
independent tests in parallel, including tests in the same file. The default
is 1; live authentication always uses 1 worker. Explicit Playwright serial
groups retain their ordering. Parallel tests must isolate shared files,
accounts and other external state. This limit is separate from `web.concurrency`
and applies to each branch/baseline side, which may run concurrently.
A spec configuration that selects zero tests (files or `grep` match nothing) or
whose runner cannot complete makes the run incomplete, even when the base has
the same problem. Set top-level `coverage.minSpecs` to require a minimum number
of executed tests, and list `specs` in `coverage.required` to make `--skip web`
an incomplete run.
Spotter supplies the Playwright runner;
specs import its adapter as above. Each test gets isolated fixture replay and
the recording's fixed clock. Use `test.use({ spotterSession: 'member',
colorScheme: 'dark' })` for configured sessions and themes. Tests use the built
app's base URL. Failures are high-severity findings compared with the merge
base; `--skip web` also skips specs. Spec discovery or runner failures block.

## Interaction journeys

Specs also test what happens after the first render: correcting invalid input,
duplicate submits, saved edits, filters and pagination restored from the URL,
back/forward navigation, dialog keyboard use and focus restoration, and routes
limited to a role. Spotter has no journey language; write them as ordinary specs.

Adopting journeys must not be invasive. Add the journey files and nothing
else: no changes to the app, its build, or its test or tooling configuration.
Name them `*.journey.mjs` (for example `qa/checkout.journey.mjs`). The
project's own unit-test runner then never collects them, because Vitest and
Jest only pick up `*.spec.*` and `*.test.*` by default. Setup inference
detects either name.

- **Writes and response sequences** belong in the spec. Recorded fixtures match
  method and URL only, so answer writes with `page.route` and keep a small
  per-test store. Assert the request body and count, and serve later reads from
  the store so a reload proves persistence. Page routes take precedence over
  Spotter's replay, and each test gets its own context, so parallel journeys
  stay isolated.
- **Focus:** check focus after keyboard operation with
  `expect(locator).toBeFocused()`, both inside the dialog and on the opener
  after it closes.
- **Roles:** use one configured session per role (`test.use({ spotterSession })`)
  and assert both the allowed and the refused view.
- **Levels:** put a tag such as `@critical` in the names of journeys that low
  should run, and select them with `levels.low.specs.grep: '@critical'`. Medium
  and high run every configured spec.

The [runnable example](../examples/journeys/items.journey.mjs) and its tiny
[app](../examples/journeys/index.html) cover each pattern. The
journeys integration test seeds a broken save, a duplicate write, lost URL
state, missing focus restoration and an unguarded route. Each one fails its
named test as a new finding.

## Recovery scenarios

Specs also test what happens after a failure: the error the user sees, Retry,
reconnecting, and controls leaving their loading or disabled state. Spotter has
no fault language; use Playwright routing in the spec, which takes precedence
over replayed fixtures:

- **Disconnects:** `route.abort('internetdisconnected')` and
  `context.setOffline(true/false)`; assert the offline message, then the reload
  after the connection returns.
- **401/403/429 and server errors:** `route.fulfill({ status })`, with a
  `retry-after` header for 429. Assert a useful message, that Retry (or Sign in)
  reloads, and that no Retry is offered where it cannot help.
- **Malformed responses:** fulfil a 200 with a truncated JSON body.
- **Response ordering:** hold one response (an unresolved promise in the route
  handler), answer a newer request first, then release the old one and assert it
  did not overwrite the newer data.
- **Retry windows:** the adapter freezes `Date` at record time, but timers run,
  so a real `Retry-After` wait works. Give the waiting expectation an explicit
  `timeout` of the documented window plus a margin. Each test has its own
  context and route state, so a fault never leaks into the next test.
- **Injected versus unexpected:** handled, injected failures produce no
  findings, because the spec stage reports only failed tests. Collect
  `page.on('pageerror')` and assert it stays empty, so an unhandled failure
  fails the named test.
- **Levels:** tag the scenarios low should run `@critical`; medium and high run
  every configured spec.

The [runnable example](../examples/recovery/scores.journey.mjs) and its
[app](../examples/recovery/index.html) cover each case. The recovery
integration test seeds a permanently disabled control, an ineffective Retry and
a stale overwrite; each fails its named test as a new finding.

Without specs, `web.faultInjection.kinds` adds disconnects, 401, 403, 429 and
malformed responses to the sweep's fault visits. Those find crashes, blank
pages and stuck loading, not whether the app recovers. See
[browser checks](browser-checks.md).

## Data edge-case scenarios

Define realistic response variants in project specs with `page.route`; a route
registered by the spec overrides Spotter's recorded replay without changing the
recording. Cover the shapes the project actually supports: empty results, long
text, missing optional fields, large lists, Unicode, zero values and unexpected
response shapes. Keep the payloads and expected rendering in the project repo
rather than asking Spotter to guess valid mutations.

Give each variant its own named test so its finding fingerprint stays stable.
In the test, collect uncaught and console errors, check horizontal overflow,
assert the project-owned rendering, and attach a screenshot whose name includes
the scenario. Tag the bounded set that low should run (for example `@critical`)
and select it with `levels.low.specs.grep`; medium and high run the full suite.

The [runnable example](../examples/data-scenarios/results.journey.mjs) covers all
seven variants, normal error/layout checks and scenario-named screenshots. Its
integration test seeds an empty-list crash, long-text overflow and missing-field
crash and compares each with the healthy baseline.

## Performance timings

A spec times an interaction by wrapping its boundary in the `spotterTiming`
fixture. The duration covers exactly the callback:

```js
test('Performance Verify: opening details is quick @perf', async ({ page, spotterTiming }) => {
  await page.goto('./');
  await spotterTiming('open details', async () => {
    await page.getByRole('button', { name: 'Open details' }).click();
    await expect(page.getByRole('region', { name: 'Details' })).toBeVisible();
  });
});
```

At `--level high`, specs matching `web.performance.timings.interactions.grep`
run again with one worker, repeated `samples` times, and each call becomes the
`interaction.<name>` metric. In normal runs the fixture just runs the callback.
Failures in the timed run add no findings (the normal run reports them). See
[performance budgets](browser-checks.md#performance-budgets) and
`examples/performance`.

## API contracts

Every successful `record` writes `fixtures/contracts.json` and
`fixtures/contract-drift.json`. The first recording establishes a baseline;
later recordings compare endpoint/session additions, removals, status codes,
content types and JSON field/type shapes. Values, object key order and array
length/order are ignored. Empty arrays describe no observed item shape, so
later nonempty arrays can show drift. These are observed snapshots, not a
complete API schema. Drift is advisory and does not change the record exit
code. `--merge` retains existing responses, so use a full re-record to detect
changes to existing endpoints.


See [authentication](authentication.md) for controlled sign-in flows and live specs.

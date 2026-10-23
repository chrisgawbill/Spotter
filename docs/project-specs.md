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
test names using a regular expression. Set `web.specs.workers: 2` to run
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

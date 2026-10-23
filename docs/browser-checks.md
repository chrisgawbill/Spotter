# Browser checks

The sweep runs axe on every route × viewport × scheme × session. New serious
or critical violations are medium severity; minor/moderate violations and
keyboard smoke findings are advisory. Keyboard smoke presses Tab and checks
reachability and outline/box-shadow focus styles; review other focus styles
manually. Composite widgets with roving tabindex are excluded from unreachable
warnings. Set `web.accessibility: false` or `web.keyboard: false` to skip them.

`web.sessions` adds isolated signed-in visits alongside anonymous visits:

```yaml
web:
  sessions:
    - name: signed-in
      localStorage: { session: '{"userId":"fixture-user","token":"test-token"}' }
      expectSelector: '[data-account-menu]'
  faultInjection:
    delayMs: 2000
    timeoutMs: 5000
    loadingSelector: '[aria-busy="true"], [role="progressbar"]'
```

Use test sessions accepted by the app's frontend; this does not bypass server
authentication. `spotter record` records each session into its own fixture map;
re-record after adding a session. Fixtures and storage values may contain
sensitive test data; keep them private. Session names must be unique letters,
numbers, underscores or hyphens, excluding `anonymous` and object prototype
property names (such as `constructor`).

Optional `expectSelector` is a project-owned session assertion: every healthy
sweep visit of that session must contain a matching element. Use something
only the signed-in state renders, so a silent redirect to sign-in is caught.
A miss does not create a finding; it makes the run incomplete and the report
names the session and how many visits failed.

Fault injection revisits each route/session at the first viewport and scheme.
Each API request observed there gets its own fresh visit returning 500, then a
visit delaying that endpoint. Other endpoints replay normally. After
`timeoutMs` (independent of the healthy-page settling delay), Spotter reports crashes, blank pages and visible loading indicators
(customize `loadingSelector` for the app). Expected injected HTTP errors are
suppressed; loading indicators already present on the healthy visit are excluded.
Loading during a delayed response is advisory: an intentionally pending request
does not prove a stuck page. A 500 loading finding records the configured
observation deadline, not proof that loading never ends.
`delayMs` controls the response delay; use a value above `timeoutMs`
to observe pending requests. Choose settling and fault budgets that allow the
app's retry window to finish. Set `web.faultInjection: false` to skip this sweep.
Screenshots include session and fault identity. Review visual changes in `report.html`; keyboard and accessibility judgment
still require human review.


See [authentication](authentication.md) for private saved sessions and
[project specs](project-specs.md) for acceptance tests.

# QA-12 cross-browser and device matrix — plan

Started by the Product Owner 2026-10-23 ("do QA-12"). Coordinator decisions below are
provisional until the Product Owner accepts a sample report.

| Question | Decision |
| --- | --- |
| Configuration | `web.browsers` (default `[chromium]`, from chromium/firefox/webkit) and `web.devices` (default `[]`, Playwright device names). |
| Universal at high (Product Owner, 2026-10-23) | Browser tests are universal for frontends, not per project: high adds all three browsers plus `HIGH_DEVICES` (iPhone 13, Pixel 7) to every web project. The earlier `levels.high` block was removed. |
| Matrix | Each browser visits routes × viewports × schemes × sessions. Each device visits routes × schemes × sessions at its own viewport, in its descriptor's engine. The first browser is the **primary case**. |
| Levels | low keeps only the first browser and no devices (exclusions kind `browser` / `device`). medium = configured matrix. high = configured ∪ all browsers ∪ `HIGH_DEVICES` (order kept, deduped). "browser matrix" leaves `UNSUPPORTED_AT_HIGH`. |
| Primary-only work | Fault visits, axe and keyboard checks run in the primary case only (DOM-level results would duplicate; WebKit Tab behaviour causes false keyboard findings). Recording visits the primary case only (fixtures are browser-independent). |
| Identity | Non-Chromium cases add `browser: <target id>` to finding keys, ` <label>` to `where`, `-<target id>` to screenshot names. Chromium stays keyless, so legacy configs keep names and fingerprints. Both sides run the same plan; the plan hash already covers the matrix. |
| Specs | When the matrix is not the default, replay specs get one Playwright project per case (`name` = target id); spec keys already include `project`. Live-auth specs stay single-browser. |
| Concurrency | One pool over all cases, bounded by `web.concurrency`; one browser instance per engine. |
| Missing browser | Launch failure throws an actionable Error (rebuild image or remove the browser); unknown device name throws before the build. Both end the run with exit 2. |
| Docker | The Playwright base image already ships Chromium, Firefox and WebKit (`/ms-playwright`); only the Dockerfile comment changes. |
| Reports/dashboard | No new UI. `summarizePlan` and the web `shape` string name the cases and per-case visit counts when the matrix is not the default; the dashboard plan preview and reports already show both strings. |

## Ownership and waves

| Wave | Agent | Files |
| --- | --- | --- |
| 0 | coordinator | `src/browsers.mjs` + `test/browsers.test.mjs` (contract, landed) |
| 1 (parallel) | engine | `src/config.mjs`, `src/levels.mjs`, `src/completeness.mjs`, `src/config-fields.mjs`, `test/config.test.mjs`, `test/levels.test.mjs`, `test/completeness.test.mjs` |
| 1 (parallel) | sweep | `src/stages/web.mjs`, `src/stages/specs.mjs`, `src/config-drift.mjs`, `test/config-drift.test.mjs`, `integration/browser-matrix.test.mjs` (new) |
| — | coordinator | README, docs, `examples/project.yml`, Dockerfile comment, `docs/plans/browser-matrix*`, verification |

Contracts: [browser-matrix-contracts.md](browser-matrix-contracts.md).

# QA-22–QA-26 same-origin API fixtures — plan

Product Owner authorization (2026-10-23): QA-22, QA-23, QA-24, QA-25 and QA-26 together; no
other backlog ticket.

Trigger: triple-crown `card-lab` run `20261023-163337-a2d002e8` reported COMPLETE/PASS while
every `/admin/...` call (relative `fetch`, proxied to `localhost:5209` by Vite in development)
reached Spotter's static server, got `index.html` with HTTP 200, and the page showed "Library
is malformed: it is not valid JSON." `web.api` was not configured, so completeness never
required fixtures (`src/completeness.mjs:74`) and nothing noticed HTML answering a JSON call.

| Question | Decision |
| --- | --- |
| How same-origin calls are replayed | The existing `context.route` replay/record handlers in `src/fixtures.mjs` get a URL predicate that matches the fake origin **or** an app-origin pathname under a `web.api.paths` prefix. One handler, one fixture map, same 404/fault/clock/session behaviour. No second interception mechanism. |
| Fixture key | Unchanged `requestKey(method, url)`: `METHOD /path?sorted=query`. It never contains origin or port, so maps replay on any Spotter server. Fake-origin and same-origin keys share one namespace. |
| Prefix matching | Segment-bound: `/api` matches `/api` and `/api/...`, never `/apix`. Prefixes are absolute app pathnames (include `web.base` if the app calls under it). |
| Recording URL | `recordFrom` (trailing slashes trimmed) + request pathname + search, for both kinds. Fake-origin results are identical to today. |
| Build env | `web.api.envVar` is set only when configured; `paths` needs no build change. |
| Recording headers | `web.api.headers` + per-session `web.sessions[].apiHeaders` (session wins, names lowercased), `${NAME}` resolved from the environment at record time, forwarded only by the record handler. Values resolved from `${...}` are redacted from stored fixture text; literal values are config, not secrets. Replay never sees them. |
| Backend | `web.api.backend: { run, readyUrl, timeoutMs }`, started by `spotter record` only, in the export root of the recorded ref, own process group, log `<fixtures>/logs/backend.log`; stopped (TERM, then KILL after 5 s) on success, failure, timeout and SIGINT/SIGTERM. Sweeps never start it. |
| Detection (QA-26) | During healthy sweep visits, an app-origin request outside `web.api.paths` that is fetch/XHR or accepts JSON and receives `text/html` is reported once per `METHOD /pathname` as high `web/api-not-replayed`. `web.ignoreRequests` suppresses it. |
| Completeness (QA-26) | The web summary lists those endpoints; any → gap `API traffic not replayed: …; configure web.api.paths and run spotter record <name>`. Head side only, so a base with the same defect never hides it. |
| Setup inference (QA-23) | Read `server.proxy` from the root Vite config syntax: literal keys → `paths`, single literal target → `recordFrom`, several targets → note. Relative literal request paths with no inferred API → note. |

## How it shows in report.md

```text
RESULT: INCOMPLETE — 1 new issues (1 high) · 0 fixed · 0 already on base (not shown)

## Incomplete coverage (1)

- API traffic not replayed: GET /admin/collections, GET /admin/library and 3 more; configure web.api.paths and run spotter record triple-crown

## New on this branch (1)

1. [high] web/api-not-replayed — API request answered with the app's HTML page: GET /admin/library
   / [anonymous] @ 375 light
   > The app asked for data on its own origin and got its HTML page (HTTP 200).
   > Configure web.api.paths for this prefix and record fixtures, or add it to web.ignoreRequests if intended.
```

When the base has the same calls, the findings are "already on base (not shown)"; the gap still
names the endpoints and the run is still INCOMPLETE.

## Ownership and waves

Contracts C1–C3 (config, fixture matching, web summary) are frozen before dispatch, so all four
coders run in one parallel wave against them.

| Agent | Tickets | Files |
| --- | --- | --- |
| replay | QA-22, QA-25, QA-26 detection | `src/config.mjs`, `src/config-fields.mjs`, `src/fixtures.mjs`, `src/stages/web.mjs`, `src/stages/specsFixture.mjs`, `test/config.test.mjs`, `test/fixtures.test.mjs` (new), `integration/same-origin-api.test.mjs` (new) |
| setup | QA-23 | `src/route-discovery.mjs`, `src/project-options.mjs`, `test/route-discovery.test.mjs`, `test/project-setup.test.mjs` |
| backend | QA-24 | `src/backend.mjs` (new), `src/cli.mjs`, `test/backend.test.mjs` (new) |
| coverage | QA-26 completeness/report | `src/completeness.mjs`, `test/completeness.test.mjs`, `test/report.test.mjs` |
| coordinator | — | README.md, `docs/*.md`, `docs/plans/api-fixtures*`, `examples/same-origin-api/` (new), `examples/project.yml`, verification |

`src/report.mjs` needs no change: gaps already render under `## Incomplete coverage`.

Contracts: [api-fixtures-contracts.md](api-fixtures-contracts.md).

## Known limits

- Requests the app sends to another origin that is neither the fake origin nor the app origin
  are not detected by QA-26 (they fail as external requests today).
- Base64 (binary) fixture bodies are not scanned for header secrets.
- The Spotter image contains Node only; a `backend.run` needing another runtime (for example
  .NET or Docker) cannot start inside the container.

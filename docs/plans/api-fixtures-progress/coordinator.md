# QA-22–QA-26 same-origin API fixtures — coordinator progress

## Plan validated against the code (branch same-origin-api-fixtures @ 3b882a8)

| Claim | Evidence |
| --- | --- |
| Replay and record intercept only the fake origin | `src/fixtures.mjs:37` and `:76` register `context.route(\`${fakeOrigin}/**\`)` |
| Fixture keys never include origin/port | `src/fixtures.mjs:9-16` `requestKey` uses `pathname` + sorted query only |
| Record URL is built by slicing the fake origin | `src/fixtures.mjs:79` |
| Build always sets the env var when `web.api` exists | `src/stages/web.mjs:82` |
| Replay/record call sites in visits | `src/stages/web.mjs:144-155` |
| Fake-origin error responses become `api-error`; app-origin ones `asset-request` | `src/stages/web.mjs:277-286`, `:295-314` |
| Specs replay only the fake origin | `src/stages/specsFixture.mjs:23-27` |
| Fault visits are built from replayed request keys | `src/stages/web.mjs:50-57` |
| `web.api` has no validation today; normalisation spreads it | `src/config.mjs:54-86`, `:129` |
| `validSession` ignores unknown keys | `src/config.mjs:139-148` |
| Fixtures required only when `web.api` is set | `src/completeness.mjs:74-77` |
| Page-visit gaps are pushed directly in `assessCompleteness` | `src/completeness.mjs:122-123` |
| Report renders every gap under Incomplete coverage | `src/report.mjs:37` |
| `recordProject` export/install/runWebStage sequence | `src/cli.mjs:244-272` |
| Static server answers unknown extensionless paths with index.html | `src/staticServer.mjs:41` |
| Vite config is read statically in one block | `src/route-discovery.mjs:273-285` |
| API inference from env vars only | `src/project-options.mjs:25-30` |
| `redactSecrets` exists for reuse | `src/sessions.mjs:35-41` |
| `context.route` accepts `(url: URL) => boolean` in Playwright 1.64 | `node_modules/playwright-core/types/types.d.ts:4504` |
| Spotter image has Node only (no .NET/Docker) | `Dockerfile:2` (Playwright image) |
| Container uses host networking, so `localhost` reaches host services | `bin/spotter` `docker run … --network host` |
| Env values reach the container only via `SPOTTER_AUTH_ENV` names | `bin/spotter` auth_env loop |

triple-crown evidence: `card-lab/src/lib/libraryUrl.ts` `LIBRARY_URL = "/admin/library"`;
`card-lab/src/lib/libraryStore.ts:33` shows "Library is malformed" when JSON parsing fails;
`card-lab/src/lib/api/client.ts` sends `X-Dev-User`/`X-Dev-Role` only when `import.meta.env.DEV`;
`card-lab/vite.config.ts` proxies `/admin` to `http://localhost:5209`;
`card-lab/src/ui/theme.tsx` `THEME_KEY = "card-lab:theme"`, default dark.

## Baseline before changes

- `npm test` (host Node 18.19.1): 86 tests, 86 pass, 0 fail.
- Browser integration in Docker (`spotter:latest`): browser-depth, specs, contracts, visual all pass;
  authentication passes only with `examples/` mounted (`-v "$PWD/examples:/opt/spotter/examples:ro"`).

## Waves

| Wave | Agent | Status |
| --- | --- | --- |
| 1 | replay, setup, backend, coverage (parallel) | Landed; diffs read and tests re-run by the coordinator |

Coordinator interventions:
- Accepted backend's extra SIGKILL to the group after a clean exit (safer); contract C5 amended.
- Wrote README/docs, the example app and the evidence; ran all verification (see docs/ticket-evidence.md#qa-22-to-qa-26).

No outstanding caller integrations. Ownership held: each agent changed only its allow-list.

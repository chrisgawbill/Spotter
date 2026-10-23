# setup (QA-23) report

Implemented C6 as specified.

- `src/route-discovery.mjs`: `evidence.proxy` / `evidence.relativeRequests`; Vite-only `server.proxy` reading inside the framework config block (unreadable-proxy note once per file); relative-request collection in the module `walk`.
- `src/project-options.mjs`: C6 proxy and relative-request blocks inserted verbatim after the env-var `web.api` block.
- Tests added in `test/route-discovery.test.mjs` (4) and `test/project-setup.test.mjs` (4) covering every case in the brief.

Verification: `node --test test/route-discovery.test.mjs test/project-setup.test.mjs` -> 15 pass, 0 fail. Full suite not run.

Notes:
- `detectProject` validates via `normalizeConfig`; `web.api = { paths, recordFrom }` passed at the time I ran (replay's config.mjs change was concurrently in the tree, so I did not isolate whether it passed before it). Re-run after integration.
- Project-setup tests read the evidence string from `result.coverage` (field `web.api`), since `detectProject` has no top-level `evidence`.
- A template-literal request like `` `/api/items/${id}` `` is recorded as path `/api/items/` (first quasi), per contract.

## ESCALATIONS
None.

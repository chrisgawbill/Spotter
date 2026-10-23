# setup report (QA-27 C5)

## Files changed
- src/backend-discovery.mjs (new): `discoverBackend` per C5.
- src/project-setup.mjs: import, `name` hoisted before the package.json block, backend wiring after `mergeSettings(config.web, options.web)`.
- test/backend-discovery.test.mjs (new, 7 tests); test/project-setup.test.mjs (+1 end-to-end test, existing unchanged).

## Verification
`node --test test/backend-discovery.test.mjs test/project-setup.test.mjs test/route-discovery.test.mjs` (Node 18): 23 pass, 0 fail. Full suite not run. The end-to-end test uses a Node backend (no `stop`), so `normalizeConfig` rejection of `stop` was not exercised; the .NET/Compose proposals (with `stop`) are covered only at `discoverBackend` level.

## Discrepancies / provisional calls
- Node seed in a different package: the contract's parenthesised form uses `cd ${q(seedDir)}`, but the shell is already in `c.dir` after `cd c.dir`, so I emit `cd ${q(rel(c.dir, seedDir))}` there (identical when c.dir is `.`; .NET unchanged, repo-root relative).
- Compose attachment notes ("Could not read" / "builds services") are placed before the tools and no-seed notes.
- Seed package search: "first package.json (sorted) under root having any seed script", script chosen by priority within it.
- Migrations project dir may resolve to an ancestor above `toolDir`.

## Required caller changes
None.

## ESCALATIONS
None beyond the provisional calls listed above (the Node seed `rel` path is a deliberate deviation from the literal contract text; please confirm).

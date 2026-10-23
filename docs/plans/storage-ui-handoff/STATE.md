# Storage page — STATE (wave 1)

## Landed and verified
- Commit 4cf936c on main: `src/prune.mjs` (retentionSettings, isActiveRun, pruneProject),
  `spotter prune`, auto-cleanup after runs, env vars forwarded by bin/spotter. Do not regress it.

## Baseline
- Host Node v18.19.1. `npm test`: 46 tests, 46 pass. Importing `src/cli.mjs` on host Node 18
  fails (Playwright needs Node 20) — pre-existing; use `node --check` for cli.mjs.
- Browser integration test runs only in the Docker image (command in docs/dashboard.md).
- No linter/typecheck configured. ESM `.mjs`, Node stdlib only, no new dependencies.

## Frozen decisions
- Settings precedence: CLI flags > env > `<SPOTTER_HOME>/retention.json` > defaults (10, 5, on).
- Dashboard shows env-set fields as disabled with the variable named.
- Storage data loads on demand (page open, refresh button, after actions), never on the 2 s poll.
- Cleanup from the dashboard uses saved settings and the existing pruneProject rules.
- Writes require same-origin JSON like existing dashboard writes. Keep Tailscale-only binding.
- Keyboard operation, visible focus, labels, status messages via role=status; status must not rely on color.
- Use existing `ds-*` classes/tokens from @chrisgawbill/aero-md3-core; minimal new CSS.
- Do not mention AI tools in code, comments, docs. No project-specific behavior in `src/`.

## In flight (wave 1, parallel)
- coder-core: src/prune.mjs, test/prune.test.mjs, src/cli.mjs, README.md
- coder-server: src/dashboard.mjs, test/dashboard.test.mjs
- coder-ui: src/dashboard/index.html, src/dashboard/dashboard.js, src/dashboard/dashboard.css, integration/dashboard.test.mjs, docs/dashboard.md

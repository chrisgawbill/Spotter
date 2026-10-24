# QA-10 interaction journeys — progress (coordinator-owned)

| Wave | Agent | Files | Status |
| --- | --- | --- | --- |
| 1 | journeys | `examples/journeys/index.html`, `examples/journeys/journeys.spec.mjs`, `integration/journeys.test.mjs` | landed, coordinator-reviewed |
| — | coordinator | `docs/project-specs.md` (Interaction journeys), `README.md` row, ticket index/evidence | done |
| — | coordinator | HockeyStatsWebApp branch `qa-interaction-journeys` (worktree `~/projects/HockeyStatsWebApp-qa-journeys`), `react/qa/journeys.spec.mjs` | committed locally, not pushed; Product Owner review |

Ownership held: the agent wrote only its three new files (checked with `git status`); no `src/` change.
Escalations: none. Accepted deviations: filter pushes history on `input`; the integration
file nests three `t.test` subtests under one test (4 reported tests).

Coordinator verification:
- `npm test` on host: 157/157 (baseline 157).
- Docker: `journeys` + `specs` + `authentication` integration 9/9; seed titles match the agent's report.
- HockeyStats via temporary `projects/qa10-journeys.yml`: low and medium COMPLETE, journeys pass (paths in `docs/ticket-evidence.md#qa-10`).

Not verified:
- Seeded consumer defect (AppDialog focus restore removed, compared against the branch). Edits to
  the consumer worktree were blocked by a tool-permission check outage. Steps: delete the
  `previousFocusRef.current?.focus(...)` line in `react/src/components/AppDialog.tsx`, set
  `baseBranch: qa-interaction-journeys` in `projects/qa10-journeys.yml`, run
  `bin/spotter run qa10-journeys --repo ~/projects/HockeyStatsWebApp-qa-journeys --working-tree`;
  expect the dialog journey as the only new spec failure. Then revert both.
- Firefox/WebKit for the example journeys (Chromium only; the matrix is QA-12's tested path).

Open: Product Owner sample acceptance; after the consumer branch merges, add
`web.specs: { files: [qa/journeys.spec.mjs] }` and `levels.low.specs.grep: '@critical'` to
`projects/hockeystats-webapp.yml`, then remove `projects/qa10-journeys.yml` and `~/spotter/qa10-journeys/`.

# QA-12 browser matrix — progress (coordinator-owned)

| Wave | Agent | Files | Status |
| --- | --- | --- | --- |
| 0 | coordinator | `src/browsers.mjs`, `test/browsers.test.mjs` | landed, 4 tests |
| 1 | engine | config, levels, completeness, config-fields + tests | landed, coordinator-reviewed |
| 1 | sweep | web stage, specs stage, scheme check, `integration/browser-matrix.test.mjs` | landed, coordinator-reviewed |
| — | coordinator | README, `docs/browser-checks.md`, `examples/project.yml`, Dockerfile comment, ticket status | done |

Ownership held: each agent changed only its allow-list (checked with `git status`).
No caller integrations outstanding (both reports: none required).

Escalations: engine changed the raw `levels` shape message to name `high`; accepted.

Coordinator verification:
- `npm test` on host: 157/157 pass (baseline 145).
- Docker integration, all files, `examples/` mounted: 17/17 pass (includes dashboard and browser-matrix).
- Real runs: see the QA-12 entry in `docs/ticket-evidence.md` (main unchanged, seeded 7/7 new, high matrix 220/220 COMPLETE; Firefox console-timing flake noted).
- Temporary `projects/qa12-matrix.yml` removed after verification; its runs remain under `~/spotter/qa12-matrix/`.
- Open: Product Owner acceptance of a sample report.
- Product Owner: browser tests are universal; high adds all browsers + iPhone 13 + Pixel 7 to every web project (`levels.high` removed).
- Fixed: dashboard-started runs inherited the read-only SSH `HOME`, so Firefox could not create a profile
  ("Failed to launch the browser process"). The dashboard now gives runs a writable `HOME` (`<tmpdir>/home`). Needs a dashboard restart.

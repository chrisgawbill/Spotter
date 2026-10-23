# Run completeness (QA-09) — coordinator progress

| Agent | Owned files | Wave | Status |
| --- | --- | --- | --- |
| engine | `src/completeness.mjs`, `test/completeness.test.mjs`, `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs` | 1 | Landed; diff reviewed; tests re-run |
| stages | `src/stages/web.mjs`, `src/stages/specs.mjs`, `test/specs.test.mjs`, `integration/specs.test.mjs`, `integration/browser-depth.test.mjs` | 1 | Landed; diff reviewed; integrations re-run |
| surface | `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`, `test/report.test.mjs`, `src/dashboard.mjs`, `src/dashboard/*`, `test/dashboard.test.mjs`, `integration/dashboard.test.mjs` | 2 | Landed; diff reviewed; tests re-run |

Ownership held (checked with `git status`). No escalations; no required caller changes.

## Coordinator interventions

- Contract fix before dispatch: baseline comparison covers only `check`/`stage` items,
  because a branch may add spec files its base lacks.
- Docs: README (run step 6, config fields, coverage section, exit codes), browser-checks,
  project-specs, dashboard, pipeline. `examples/deploy/Jenkinsfile` and the local
  ignored `Jenkinsfile`: exit 3 archives the report and fails as "coverage is incomplete".
- `src/dashboard/index.html`: `aria-label="Coverage gaps"` on the gap list.

## Verification (coordinator, 2026-10-23)

- `npm test`: 71/71 (baseline 52/52).
- Docker: `integration/specs.test.mjs` 3/3, `integration/browser-depth.test.mjs` 2/2,
  `integration/dashboard.test.mjs` 1/1.
- Real seeded runs (scratch clone of HockeyStatsWebApp, temporary `projects/qa09-seed.yml`):
  healthy no-op branch with optional `--skip rules` -> PASS exit 0, COMPLETE;
  session key renamed -> exit 3 `member: expected state not reached on 4/4 visits`;
  `--skip static` with `format` required -> exit 3 `format: required but skipped`;
  `grep: NO-SUCH-TEST` -> exit 3 `specs: selected zero tests` (was a suppressed PASS before);
  broken-build base -> exit 3 `baseline: base did not run: web`.

- HockeyStats main (`bin/spotter run hockeystats-webapp --ref main`): exit 1, 17 findings
  (same commit, every real finding shown; matches earlier main runs), coverage COMPLETE,
  66/66 page visits. An earlier attempt showed 6 extra `ERR_NETWORK_CHANGED` asset
  findings while other Docker containers were starting; the isolated rerun did not.
- Temporary `projects/qa09-seed.yml` removed after verification; its runs remain under
  `~/spotter/qa09-seed/runs/`.

## Explicitly unverified

- A base side that throws (as opposed to running with failures): code-reviewed only.
- QA-08 level integration: deferred; `completeness.level` is `null`.
- Product Owner sample-report acceptance.

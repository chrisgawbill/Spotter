# QA-08 testing levels — plan

Product Owner decisions (2026-10-23):

| Question | Decision |
| --- | --- |
| What `low` runs | Only `coverage.required` checks (rules count as a requirable item: excluded unless required) plus a configured critical-route smoke set: `levels.low.routes` at the first viewport and first colour scheme, every session, no fault visits. Specs only when required or narrowed by `levels.low.specs.grep`. |
| What `high` adds | Nothing yet: high runs the medium plan and lists wider browser, data, recovery and performance scenarios as unsupported (QA-12, QA-13, QA-11, QA-15). |
| Unconfigured level | Rejected before anything starts (CLI exit 2, dashboard 400). `medium` and `high` need no config; `low` needs `levels.low`. |
| Dashboard | Level selector beside Branch, plan preview from read-only `GET /api/plan`, `level` on `POST /api/runs`. |

## Design

One pure function, `resolvePlan(config, selected)` in `src/levels.mjs`, narrows the
normalized config. The CLI runs **both sides** with the plan's config and skip set, so the
branch and baseline plans are the same by construction. The completeness item list and
page-visit counts are derived from the narrowed config, so they follow the plan
automatically. Exclusions become completeness items with status `excluded`, which are
never gaps. The plan hash is added to the baseline cache key.

No `levels` block and no `--level`: `resolvePlan` returns the config unchanged and
`record: null`, so behaviour is identical to today and `completeness.level` stays `null`.

Precedence: explicit `--level` / dashboard choice > `levels.default` > none.

## Config

```yaml
levels:
  default: medium            # optional: low | medium | high
  low:                       # optional; required before low can be selected
    routes: [home, standings]  # required when web is set: names from web.routes
    specs: { grep: '@smoke' }  # optional; requires web.specs
```

## Ownership and waves (serial)

| Wave | Agent | Files |
| --- | --- | --- |
| 1 | engine | `src/levels.mjs` (new), `src/config.mjs`, `src/completeness.mjs`, `src/config-fields.mjs`, `test/levels.test.mjs` (new), `test/completeness.test.mjs`, `test/config.test.mjs` |
| 2 | surface | `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`, `src/dashboard.mjs`, `src/dashboard/index.html`, `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css`, `test/cli.test.mjs` (new), `test/dashboard.test.mjs`, `test/report.test.mjs`, `integration/dashboard.test.mjs` |
| — | coordinator | README.md, docs/*.md, `docs/plans/testing-levels*`, `examples/project.yml`, verification |

Contracts: [testing-levels-contracts.md](testing-levels-contracts.md).

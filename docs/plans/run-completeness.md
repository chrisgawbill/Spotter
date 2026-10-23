# QA-09 — Coverage and run completeness: implementation plan

Ticket: [QA-09](../ticket-index.md#qa-09--coverage-and-run-completeness).
Contracts: [run-completeness-contracts.md](run-completeness-contracts.md).

## Problem (verified against the tree at da60f96)

A PASS today only means "no new high/medium finding". Several failures turn into a
pass because the same failure also happens on the merge base and is suppressed as
`existingFindings`:

- Install or build fails on head and base: `static/install` or `web/build` is an
  existing finding, checks and the sweep never run, result PASS
  (`src/cli.mjs` exit = `hasFailingFinding(comparison.newFindings)`).
- Specs select zero tests (`files`/`grep` match nothing): Playwright exits 1, the
  runner finding `project specs could not complete` (`src/stages/specs.mjs:57`) is the
  same on base, result PASS.
- A named session silently lands on a sign-in page: every check still "passes".
- A page visit times out on both sides (`web/navigation`): suppressed.
- No fixtures recorded: every API call is an `unrecorded-request` on both sides.
- A base side that throws aborts the whole run (`Promise.all` in `runProject`), with
  no recorded baseline status.

## Design

Completeness is computed from the **head side only** (stage summaries + config +
`--skip`), never through baseline comparison, so suppression cannot hide it.

1. `src/completeness.mjs` (new, pure): turns config + skip + head stage summaries +
   fixtures + baseline status into `report.json.completeness`
   (items, counts, gaps, fixtures identity, baseline status, `status`).
2. Config: optional top-level `coverage: { required: [...], minSpecs }` and optional
   per-session `expectSelector`.
3. Stages expose what they executed: web summary adds failed page/fault visit counts
   and per-session assertion counts; specs summary adds selected/flaky/completed.
4. CLI: a base side that throws becomes `baseline.status = failed` instead of
   aborting; exit 3 = incomplete. Precedence: 2 (Spotter error) > 3 (incomplete) >
   1 (new blocking findings) > 0.
5. Reports: `RESULT: INCOMPLETE`, an `## Incomplete coverage` list and a
   `- coverage:` line in Markdown; a coverage table in HTML; full object in JSON.
6. Dashboard: `incomplete` status (text + icon, not color only) and the same
   one-line coverage summary, produced by the same function as the reports.
7. Docs and Jenkinsfile: exit code 3, config fields.

Rules (frozen in contracts): configured-but-not-executed work without an intentional
reason is always a gap; an intentional `--skip` is an explained exclusion unless the
item is in `coverage.required`; `minSpecs` counts executed (non-skipped) tests.

## Deferred / out of scope

- QA-08 level integration: QA-08 is not implemented. `completeness.level` is always
  `null`; reports must not claim level coverage.
- Fixture age thresholds (age is recorded, never judged).
- Session assertions inside project specs (sweep visits only).

## Ownership and waves

| Agent | Files | Wave |
| --- | --- | --- |
| engine | `src/completeness.mjs` (new), `test/completeness.test.mjs` (new), `src/config.mjs`, `src/config-fields.mjs`, `test/config.test.mjs` | 1 |
| stages | `src/stages/web.mjs`, `src/stages/specs.mjs`, `test/specs.test.mjs`, `integration/specs.test.mjs`, `integration/browser-depth.test.mjs` | 1 |
| surface | `src/cli.mjs`, `src/report.mjs`, `src/htmlReport.mjs`, `test/report.test.mjs`, `src/dashboard.mjs`, `src/dashboard/dashboard.js`, `src/dashboard/index.html`, `src/dashboard/dashboard.css`, `test/dashboard.test.mjs`, `integration/dashboard.test.mjs` | 2 |
| coordinator | `README.md`, `docs/*.md`, `Jenkinsfile`, this plan, contracts, handoff/progress files | all |

## Verification

`npm test`; Docker integrations `specs`, `browser-depth`, `dashboard`; HockeyStats
main run and a seeded checkout with: zero selected specs, a sign-in redirect for a
session with `expectSelector`, a `--skip` of a required check, and a failed baseline.

# dashboard-pdf report

Files changed: src/dashboard.mjs, src/dashboard/index.html, src/dashboard/dashboard.js, test/dashboard.test.mjs, integration/dashboard.test.mjs, docs/dashboard.md (css untouched).

Tests: `npm test` 157 tests, 157 pass, 0 fail (report-html's edits were also passing at that moment).
Integration (docker spotter:latest, dashboard.test.mjs): tests 1, pass 1, fail 0 (download click, filename and %PDF checked).

Deviation: `chromium` is imported dynamically inside renderReportPdf (`await import('playwright')`), not at top level. Playwright calls process.exit at import on Node 18 (the host), which killed test/dashboard.test.mjs.

## Required caller changes
None.

## ESCALATIONS
Dynamic playwright import instead of the contract's top-level import (reason above). Functionally identical on Node 20+; revert to static if the host is moved to Node 20.

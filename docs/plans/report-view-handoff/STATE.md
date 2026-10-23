# STATE: report view tidy-up and PDF download

- Landed and verified by the coordinator: report-html (Contract A) and dashboard-pdf (Contract B).
- Coordinator CSS follow-ups in `src/htmlReport.mjs`:
  - table cells use `overflow-wrap:anywhere` and badges use `nowrap`;
  - `.findings` rows stack under 600px;
  - the Issue header has a `width:55%` hint, so print/PDF columns stay balanced.
- Accepted deviation: `renderReportPdf` imports Playwright dynamically, because the host runs Node 18 and Playwright exits at import.
- Verification on 2026-10-23:
  - `npm test` 157/157 pass (baseline 156; one new report test; the PDF route assertions were added to an existing dashboard test);
  - docker `integration/dashboard.test.mjs` 1/1 pass, including the real PDF download.
- Not run: the AGENTS.md hockeystats-webapp main/seeded runs (no finding logic changed).
- Old runs keep their old-style `report.html`; the PDF prints whatever `report.html` is stored.

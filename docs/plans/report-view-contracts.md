# Report view tidy-up and PDF download: plan and contracts

> These decisions are frozen. Do not redesign, rename, or "improve" them. If a contract
> genuinely cannot be implemented as written, stop and report it to the coordinator
> instead of substituting your own design.

## Goal

1. `report.html` (the dashboard's **Report** view and the standalone file) gets readable
   tables and colour: result banner, a findings table, compact screenshot thumbnails, a
   styled coverage table, light and dark themes, and print CSS.
2. The dashboard gets a **Download PDF** button that downloads the current run's report
   as a PDF, rendered on the server by the already-installed Playwright Chromium.

Before screenshot: full-width screenshots stacked one after another, the whole report
dumped as one `<pre>`, and an unstyled coverage table.

## Agent ownership

| Agent | Files |
| --- | --- |
| `report-html` | `src/htmlReport.mjs`, `src/report.mjs`, `test/report.test.mjs` |
| `dashboard-pdf` | `src/dashboard.mjs`, `src/dashboard/index.html`, `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css`, `test/dashboard.test.mjs`, `integration/dashboard.test.mjs`, `docs/dashboard.md` |

## Contract A: report.html structure (`report-html`)

- `report.mjs` exports the existing private helpers `renderPlace(group, variantCount)` and
  `renderStageSummary(run)` unchanged, and adds `export function resultOf(run)`, which returns
  `'INCOMPLETE' | 'FAIL' | 'PASS'` using the logic already in `renderMarkdownReport`. That
  function calls it, so the logic stays in one place. Also export `describeCounts`.
- The order of the body content (all values escaped as they are today):
  1. `<h1>Spotter: {project}</h1>`, then `<p class="meta">head: {label} @ {shortSha} · base: {describeBase} · {duration}</p>`
     (export `describeBase` and `formatDuration` too).
  2. The links paragraph `<p><a href="report.md">Markdown</a> · <a href="report.json">JSON</a> · <a href="logs/">Logs</a></p>`,
     byte-identical so the dashboard's embed regex still strips it. Add no attributes.
  3. `<p class="result result-{pass|fail|incomplete}"><strong>{PASS|FAIL|INCOMPLETE}</strong> — {describeCounts}</p>`.
     The word carries the meaning and the colour only reinforces it.
  4. `<h2>New on this branch ({n})</h2>` followed by a `.table-wrap` div holding
     `<table class="findings">`. The header columns are `#`, `Severity`, `Issue`, `Where`. The
     Severity cell is `<span class="badge sev-{severity}">{severity}</span>`. The Issue cell
     is `<strong>{title}</strong>` + `<div class="muted">{stage}/{check}</div>`, then the first
     3 detail lines in `<pre class="detail">` when present, then `<div class="muted">repro: <code>{repro}</code></div>`
     when present. Where = `{n}× ` (when more than 1) + `renderPlace(group, variantCount)`.
     Show at most 25 groups, as the markdown report does, and when there are none show
     `<h2>New on this branch</h2><p>Nothing new.</p>`.
  5. `<h2>Checks</h2><ul class="checks">`, one `<li>` per `renderStageSummary` line with the leading `- ` removed.
  6. The existing `coverage()` section, kept as `<h2>Coverage</h2><p>…</p>` with the notes still
     rendered exactly `<p>Note: …</p>` (the tests depend on it). The table is wrapped in `.table-wrap` with
     `class="coverage"`, and the Status cell becomes `<span class="badge status-{status}">{status}</span>`.
  7. Only when some new group has artifacts: `<h2>Screenshots</h2>`, then per such group
     `<section class="evidence"><h3>{title}</h3><div class="shots">{figures}</div></section>`.
     Keep `image()` and its `Screenshot` alt text as they are. These h3 headings are what the
     integration test finds by role.
  8. Visual review exactly as today, with the same text for the
     `<h2>Visual review (advisory)</h2><p>…</p>` line. Each `<details>` keeps `.images`.
  9. `<details class="plain"><summary>Plain-text report (report.md)</summary><pre>{markdown}</pre></details>`,
     so nothing from the old `<pre>` is lost (fixed list, details).
- CSS stays in the single inline `<style>` (the CSP allows only inline styles and no external resources):
  - Use custom properties on `:root` (`--bg --fg --muted --border --link --surface`, plus
    `--ok-bg/--ok-fg`, `--warn-bg/--warn-fg`, `--bad-bg/--bad-fg`, `--info-bg/--info-fg`), with
    `color-scheme: light dark` and a `@media (prefers-color-scheme: dark)` override.
  - Severity: high → bad, medium → warn, low → info. Status: pass/executed/complete → ok,
    fail/failed/missing → bad, incomplete/skipped → warn, excluded → info.
  - Tables: `border-collapse:collapse; width:100%`, cell padding, a 1px bottom border, a
    surface-coloured header, `vertical-align:top`, and tabular numbers. `.table-wrap{overflow-x:auto}`.
  - `.shots` and `.images`: a grid of `repeat(auto-fill,minmax(240px,1fr))`. Images use
    `width:100%`, a border and radius, and link to the full-size file as they do now.
  - Badges: an inline-block pill, a small bold font, and the background/foreground pair.
    `.result` is a banner with a left border in the matching colour.
  - Print: `@page{margin:12mm}`, plus `@media print{` force light colours, `body{margin:0;max-width:none}`,
    `details::details-content{content-visibility:visible}` (opens closed details in Chromium
    PDFs), `tr,figure,section{break-inside:avoid}`, `*{print-color-adjust:exact}`, and hide
    the links paragraph via `body>p:has(a[href="report.md"])` `}`.

## Contract B: PDF route and button (`dashboard-pdf`)

- `GET /artifacts/{project}/{id}/report.pdf` uses the same project/id/root validation
  as the other artifacts. When `parts` is exactly `['report.pdf']`, resolve
  `realpath(root/report.html)`. If it is missing, send the existing 404 JSON
  (`Artifact not found`). Otherwise `const pdf = await renderPdf(file, root)` and respond 200 with
  `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="spotter-{project}-{id}.pdf"`
  (the names are already restricted to `[A-Za-z0-9._-]`), and the same sandbox CSP header as the
  other artifacts.
- `createDashboardServer` takes a new option `renderPdf = renderReportPdf` so that unit tests
  can inject a fake.
- `export async function renderReportPdf(file, root)` in `dashboard.mjs`:
  ```js
  const browser = await chromium.launch();   // import { chromium } from 'playwright'
  try {
    const page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
    const allowed = `${pathToFileURL(root).href}/`;
    await page.route('**/*', (route) => route.request().url().startsWith(allowed) ? route.continue() : route.abort());
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => Promise.all([...document.images].map((image) => { image.loading = 'eager'; return image.decode().catch(() => {}); })));
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally { await browser.close(); }
  ```
  Put a `// ponytail:` comment on it saying that each download launches its own Chromium,
  and that a shared browser or cache would be the upgrade if downloads become frequent.
  (Verified in the spotter image, Chromium 156: `page.route` intercepts `file://`, and `evaluate` works with JS disabled.)
- UI: right after `#copy-report` in `index.html`, add
  `<a id="download-report" class="ds-button button-secondary" download>Download PDF</a>`.
  In `dashboard.js`, inside the `if (run.report && $('report').dataset.report !== run.report)`
  block and after `dataset.report` is set, add `$('download-report').href = reportUrl('pdf');`.
  The button is independent of the selected format: it is always the HTML report as a PDF.
- Docs: in `docs/dashboard.md`, after the "**Copy** copies …" sentence, add one sentence
  saying that **Download PDF** saves the HTML report as a PDF, rendered on the server with the
  image's Chromium (scripts off, only files from that run folder).

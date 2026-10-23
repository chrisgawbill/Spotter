import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFinding } from '../src/findings.mjs';
import { groupFindings, renderMarkdownReport } from '../src/report.mjs';

const overflowAt = (viewport, colorScheme) =>
  createFinding({
    stage: 'web',
    check: 'horizontal-overflow',
    severity: 'medium',
    title: 'page scrolls sideways',
    where: `#/compare @${viewport} ${colorScheme}`,
    key: { route: '#/compare', viewport, colorScheme },
  });

test('the same page problem at several variants is one group', () => {
  const groups = groupFindings([overflowAt(375, 'light'), overflowAt(375, 'dark'), overflowAt(768, 'light')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 3);
});

test('report leads with the result and lists new findings with place and repro', () => {
  const typeError = createFinding({ stage: 'static', check: 'typecheck', severity: 'high', title: 'TS2322: bad', file: 'react/src/a.ts', line: 3, repro: 'cd react && tsc' });
  const markdown = renderMarkdownReport({
    project: 'demo',
    head: { label: 'feature/x', sha: 'abc1234', shortSha: 'abc1234', stages: { static: [{ name: 'typecheck', status: 'FAIL', count: 1 }], rules: 'skipped' } },
    base: { label: 'main merge base', sha: 'def5678', shortSha: 'def5678' },
    fixtures: null,
    comparison: { newFindings: [typeError, overflowAt(375, 'light'), overflowAt(375, 'dark')], existingFindings: [], fixedFindings: [] },
    durationMs: 75_000,
    paths: { reportJson: '/r/report.json', screenshots: '/r/shots', logs: '/r/logs' },
  });
  assert.match(markdown, /RESULT: FAIL — 2 new issues \(1 high, 1 medium\)/);
  assert.match(markdown, /1\. \[high\] static\/typecheck — TS2322: bad\n {3}react\/src\/a\.ts:3\n {3}repro: cd react && tsc/);
  assert.match(markdown, /2\. \[medium\] web\/horizontal-overflow — page scrolls sideways\n {3}2× #\/compare @ 375 light, 375 dark/);
  assert.match(markdown, /- rules: skipped/);
});

test('HTML escapes report content and keeps image URLs relative', async () => {
  const { renderHtmlReport } = await import('../src/htmlReport.mjs');
  const html = renderHtmlReport({
    project: '<script>bad</script>', comparison: { newFindings: [] },
    visual: { status: 'compared', unchanged: 1, changes: [{ name: 'a & b.png', status: 'added', after: 'screenshots/a & b.png' }] },
  }, '<img src=x onerror=bad>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /screenshots\/a%20%26%20b.png/);
  assert.match(html, /1 unchanged/);
});

const completeness = (status, gaps) => ({
  status, gaps, counts: { pages: { expected: 4, executed: 2, failed: 2, skipped: 0 }, faultVisits: null, specs: null },
  baseline: { status: 'compared', reason: null }, fixtures: null,
  items: [{ name: 'web', kind: 'stage', required: true, status: 'missing', reason: '<b>x</b> & more' }],
});
const coverageRun = (value) => ({
  project: 'demo', head: { label: 'x', shortSha: 'abc', stages: { rules: { ruleCount: 1, boundaryCount: 0 } } }, base: null, fixtures: null,
  comparison: { newFindings: [], existingFindings: [], fixedFindings: [] }, durationMs: 1000, paths: {}, completeness: value,
});

test('incomplete runs lead with INCOMPLETE and list the gaps', () => {
  const markdown = renderMarkdownReport(coverageRun(completeness('incomplete', ['web: build failed', '2 of 4 page visits failed to load'])));
  assert.match(markdown, /RESULT: INCOMPLETE — nothing new/);
  assert.match(markdown, /## Incomplete coverage \(2\)\n\n- web: build failed\n- 2 of 4 page visits failed to load/);
  assert.match(markdown, /- coverage: INCOMPLETE ·/);
});

test('a not-replayed API gap renders as incomplete coverage', () => {
  const gap = 'API traffic not replayed: GET /api/items; configure web.api.paths and run spotter record demo';
  const markdown = renderMarkdownReport(coverageRun(completeness('incomplete', [gap])));
  assert.match(markdown, /RESULT: INCOMPLETE/);
  assert.match(markdown, /## Incomplete coverage \(1\)/);
  assert.ok(markdown.includes(`- ${gap}`));
});

test('complete runs keep PASS and show the coverage line', () => {
  const markdown = renderMarkdownReport(coverageRun(completeness('complete', [])));
  assert.match(markdown, /RESULT: PASS/);
  assert.match(markdown, /- coverage: COMPLETE/);
  assert.doesNotMatch(markdown, /Incomplete coverage/);
});

test('HTML coverage section escapes reasons and lists gaps', async () => {
  const { renderHtmlReport } = await import('../src/htmlReport.mjs');
  const html = renderHtmlReport(coverageRun(completeness('incomplete', ['web: build failed'])), 'md');
  assert.match(html, /<h2>Coverage<\/h2>/);
  assert.match(html, /<li>web: build failed<\/li>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; more/);
  assert.ok(!html.includes('<b>x'));
});

test('reports show the plan line before coverage and list what high cannot add', async () => {
  const { renderHtmlReport } = await import('../src/htmlReport.mjs');
  const run = { ...coverageRun({ ...completeness('complete', []), level: { name: 'high', source: 'selected', exclusions: [], unsupported: [{ name: 'browser matrix', ticket: 'QA-12', reason: 'not implemented' }] } }), plan: 'level high (selected) · 2 checks' };
  const markdown = renderMarkdownReport(run);
  assert.match(markdown, /- plan: level high \(selected\) · 2 checks\n- coverage: /);
  assert.match(renderHtmlReport(run, markdown), /<p>Not available at level high: browser matrix \(QA-12\)<\/p>/);
});

test('live authentication is identified without claiming a failed build or branch comparison', () => {
  const markdown = renderMarkdownReport({
    project: 'demo', head: { label: 'auth (live authentication)', shortSha: 'abc', stages: { web: { pages: 0, specs: { mode: 'live', passed: 2, failed: 0, skipped: 0 } } } },
    base: null, fixtures: null, comparison: { newFindings: [], existingFindings: [], fixedFindings: [] },
    durationMs: 1000, paths: {},
  });
  assert.match(markdown, /live authentication: 2 passed/);
  assert.match(markdown, /no sweep/);
  assert.doesNotMatch(markdown, /build failed/);
});

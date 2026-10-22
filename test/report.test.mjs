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

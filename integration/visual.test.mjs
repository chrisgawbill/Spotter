import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { compareScreenshots } from '../src/visual.mjs';
import { renderHtmlReport } from '../src/htmlReport.mjs';

test('visual comparison handles unchanged, changed, resized, added and removed pages with portable links', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-visual-'));
  const base = path.join(root, 'base');
  const run = path.join(root, 'run');
  const head = path.join(run, 'screenshots');
  const browser = await chromium.launch();
  try {
    await mkdir(base, { recursive: true });
    await mkdir(head, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 20, height: 20 } });
    const shot = async (dir, name, color) => {
      await page.setContent(`<style>body{margin:0;background:${color}}</style>`);
      await page.screenshot({ path: path.join(dir, name) });
    };
    for (const dir of [base, head]) {
      await shot(dir, 'same.png', 'white');
      await shot(dir, 'changed.png', dir === base ? 'red' : 'blue');
      await shot(dir, 'resize.png', 'white');
    }
    await page.setViewportSize({ width: 25, height: 20 });
    await shot(head, 'resize.png', 'white');
    await shot(head, 'added.png', 'white');
    await shot(base, 'removed.png', 'white');
    const visual = await compareScreenshots(head, base, run);
    assert.equal(visual.unchanged, 1);
    assert.deepEqual(visual.changes.map((c) => [c.name, c.status]), [
      ['added.png', 'added'], ['changed.png', 'changed'], ['removed.png', 'removed'], ['resize.png', 'changed'],
    ]);
    assert.equal(visual.changes.find((c) => c.name === 'changed.png').changedPixels, 400);
    assert.equal(visual.changes.find((c) => c.name === 'resize.png').changedPixels, 100);
    const html = renderHtmlReport({ project: '<script>x</script>', comparison: { newFindings: [] }, visual }, '<script>bad</script>');
    assert.ok(!html.includes('<script>'));
    for (const change of visual.changes) for (const file of [change.before, change.after, change.diff].filter(Boolean)) {
      assert.ok((await readFile(path.join(run, file))).length);
      assert.ok(html.includes(file));
    }
    assert.equal((await compareScreenshots(head, null, run)).status, 'no baseline');
    assert.equal((await compareScreenshots(head, path.join(root, 'missing'), run)).status, 'screenshots unavailable');
    assert.equal((await compareScreenshots(head, head, run)).changes.length, 0);
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

// Run in the Spotter image: node --test integration/browser-matrix.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config.mjs';
import { deviceOptions, launchBrowsers, runWebStage } from '../src/stages/web.mjs';
import { compareWithBaseline } from '../src/findings.mjs';

const page = (script = '') => `<!doctype html><html lang="en"><head><title>Matrix</title></head><body><main><h1>Matrix app</h1></main><script>${script}</script></body></html>`;
const spec = `
  const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);
  test('heading renders', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('Matrix app');
  });
`;

async function setup(web) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-matrix-'));
  await mkdir(path.join(dir, 'dist'));
  await mkdir(path.join(dir, 'logs'));
  await writeFile(path.join(dir, 'matrix.spec.mjs'), spec);
  const config = normalizeConfig({ repo: dir, web: { build: { run: 'true' }, routes: ['/'], viewports: [375], colorSchemes: ['light'], settleMs: 0, ...web } }, { projectName: 'matrix' });
  const run = () => runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), fixtures: { entries: {}, sessions: {} } });
  return { dir, config, run };
}

test('one journey runs in every browser and device with distinct screenshots and per-project specs; Firefox-only defects are new only for Firefox', async () => {
  const { dir, run } = await setup({ browsers: ['chromium', 'firefox', 'webkit'], devices: ['iPhone 13'], faultInjection: false, specs: { files: ['matrix.spec.mjs'] } });
  try {
    await writeFile(path.join(dir, 'dist/index.html'), page());
    const healthy = await run();
    assert.equal(healthy.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').length, 0, JSON.stringify(healthy.findings));
    assert.equal(healthy.summary.pages, 4);
    assert.equal(healthy.summary.specs.selected, 4, JSON.stringify(healthy.summary.specs));
    assert.deepEqual(healthy.summary.targets.map((t) => [t.id, t.pages]), [['chromium', 1], ['firefox', 1], ['webkit', 1], ['iphone-13', 1]]);
    assert.match(healthy.summary.shape, / in chromium 1, firefox 1, webkit 1, iPhone 13 1$/);
    const shots = await readdir(path.join(dir, 'screenshots'));
    assert.equal(shots.length, 4, shots.join());

    await writeFile(path.join(dir, 'dist/index.html'), page(`if (navigator.userAgent.includes('Firefox')) { document.querySelector('h1').textContent = 'Broken'; throw new Error('firefox only'); }`));
    const seeded = await run();
    const fresh = compareWithBaseline(seeded.findings, healthy.findings).newFindings;
    assert(fresh.length >= 2, JSON.stringify(fresh));
    assert(fresh.some((f) => f.check === 'uncaught-error' && f.where.endsWith(' firefox')));
    assert(fresh.some((f) => f.check === 'project-spec' && f.title.includes('heading renders')));
    assert(fresh.every((f) => f.where?.endsWith(' firefox') || f.check === 'project-spec'), JSON.stringify(fresh));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a browser that cannot launch fails with a rebuild hint and closes earlier browsers', async () => {
  let closed = 0;
  const types = {
    chromium: { launch: async () => ({ close: async () => { closed += 1; } }) },
    firefox: { launch: async () => { throw new Error("Executable doesn't exist at /x\nmore"); } },
  };
  await assert.rejects(launchBrowsers(['chromium', 'firefox'], types), {
    message: "Cannot launch firefox: Executable doesn't exist at /x. Rebuild the Spotter image (bin/spotter build-image); firefox is needed at level high and wherever web.browsers or web.devices use it.",
  });
  assert.equal(closed, 1);
});

test('an unknown device is rejected before the app is built', async () => {
  const { dir, run } = await setup({ build: { run: 'false' }, devices: ['Nokia 3310'] });
  try {
    await assert.rejects(run(), { message: 'Unknown Playwright device "Nokia 3310" in web.devices; use a name from Playwright\'s device list such as "iPhone 13".' });
    assert.equal(deviceOptions('iPhone 13').engine, 'webkit');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a legacy configuration keeps unsuffixed screenshot names and locations', async () => {
  const { dir, run } = await setup({});
  try {
    await writeFile(path.join(dir, 'dist/index.html'), page(`throw new Error('boom');`));
    const result = await run();
    const error = result.findings.find((f) => f.check === 'uncaught-error');
    assert.equal(error.where, '/ [anonymous] @375 light');
    assert.deepEqual(error.artifacts.map((file) => path.basename(file)), ['-375-light-anonymous.png']);
    assert(!result.summary.shape.includes(' in '));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Run in the Spotter image: node --test integration/same-origin-api.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config.mjs';
import { dedupeFindings } from '../src/findings.mjs';
import { runWebStage } from '../src/stages/web.mjs';

const TOKEN = 'tok-3f9a-not-for-fixtures';
const page = (script) => `<!doctype html><html lang="en"><head><title>Same origin</title></head><body><main><h1>Items</h1><p id="out">loading</p></main><script>${script}</script></body></html>`;
const itemsScript = "fetch('/api/items', { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => { document.getElementById('out').textContent = 'items ' + (d.items || []).length; }).catch(() => {});";
const missingScript = "fetch('/api/missing', { headers: { Accept: 'application/json' } }).then((r) => { if ((r.headers.get('content-type') || '').includes('html')) throw new Error('received HTML for an API path'); });";

async function withProject(body) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-same-origin-'));
  const seen = [];
  const live = createServer((request, response) => {
    seen.push(request.url);
    response.setHeader('content-type', 'application/json');
    const token = request.headers['x-api-token'];
    if (!token) { response.statusCode = 401; return response.end('{"error":"missing token"}'); }
    if (request.url !== '/api/items') { response.statusCode = 404; return response.end('{"error":"nope"}'); }
    response.end(JSON.stringify({ items: [{ id: 1 }], token }));
  });
  await new Promise((resolve) => live.listen(0, '127.0.0.1', resolve));
  const previous = process.env.SPOTTER_TEST_TOKEN;
  process.env.SPOTTER_TEST_TOKEN = TOKEN;
  try {
    await mkdir(path.join(dir, 'dist'));
    await mkdir(path.join(dir, 'logs'));
    const run = (config, options = {}) => runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), ...options });
    await body({ dir, run, seen, recordFrom: `http://127.0.0.1:${live.address().port}`, writeApp: (script) => writeFile(path.join(dir, 'dist/index.html'), page(script)) });
  } finally {
    if (previous === undefined) delete process.env.SPOTTER_TEST_TOKEN; else process.env.SPOTTER_TEST_TOKEN = previous;
    await new Promise((resolve) => live.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

const webConfig = (dir, web) => normalizeConfig({ repo: dir, web: { build: { run: 'true' }, routes: ['/'], viewports: [375], colorSchemes: ['light'], settleMs: 0, accessibility: false, keyboard: false, faultInjection: { delayMs: 80, timeoutMs: 160 }, ...web } }, { projectName: 'same-origin' });

test('same-origin API paths record with headers, redact secrets, replay and take fault visits', async () => {
  await withProject(async ({ dir, run, recordFrom, writeApp }) => {
    const config = webConfig(dir, { api: { paths: ['/api'], recordFrom, headers: { 'x-api-token': '${SPOTTER_TEST_TOKEN}' } } });
    await writeApp(itemsScript);
    const recordedEntries = { entries: {}, sessions: {} };
    await run(config, { mode: 'record', recordedEntries });
    const entry = recordedEntries.entries['GET /api/items'];
    assert.equal(entry.status, 200);
    assert(entry.body.includes('"items"'));
    assert(!entry.body.includes(TOKEN), entry.body);

    const fixtures = recordedEntries;
    const healthy = await run(config, { fixtures });
    assert.equal(healthy.findings.filter((f) => f.severity === 'medium' || f.severity === 'high').length, 0, JSON.stringify(healthy.findings));
    assert.deepEqual(healthy.summary.apiNotReplayed, []);
    assert.equal(healthy.summary.faultVisits, 2);
    assert.equal(healthy.summary.faultVisitsFailed, 0);

    await writeApp(`${itemsScript}${missingScript}`);
    const missing = await run(config, { fixtures });
    assert(missing.findings.some((f) => f.check === 'unrecorded-request' && f.title.endsWith('GET /api/missing')), JSON.stringify(missing.findings));
    assert(!missing.findings.some((f) => f.check === 'uncaught-error'), JSON.stringify(missing.findings));
    assert.deepEqual(missing.summary.apiNotReplayed, []);
  });
});

test('an unconfigured API path answered with the app HTML is reported once and can be ignored', async () => {
  await withProject(async ({ dir, run, writeApp }) => {
    await writeApp("fetch('/data/items', { headers: { Accept: 'application/json' } }).then((r) => r.text());");
    const config = webConfig(dir, { viewports: [375, 1280] });
    const result = await run(config);
    const found = dedupeFindings(result.findings).filter((f) => f.check === 'api-not-replayed');
    assert.equal(found.length, 1, JSON.stringify(result.findings));
    assert.equal(found[0].severity, 'high');
    assert(found[0].title.endsWith('GET /data/items'), found[0].title);
    assert.deepEqual(result.summary.apiNotReplayed, ['GET /data/items']);

    const ignored = await run(webConfig(dir, { ignoreRequests: ['/data/'] }));
    assert(!ignored.findings.some((f) => f.check === 'api-not-replayed'));
    assert.deepEqual(ignored.summary.apiNotReplayed, []);
  });
});

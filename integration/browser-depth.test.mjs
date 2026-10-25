// Run in the Spotter image: node --test integration/browser-depth.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config.mjs';
import { runWebStage } from '../src/stages/web.mjs';
import { compareWithBaseline } from '../src/findings.mjs';
import { FAULT_KINDS } from '../src/levels.mjs';

const shell = (body) => `<!doctype html><html lang="en"><head><title>Depth check</title><style>button:focus-visible{outline:3px solid blue}</style></head><body><main><div aria-busy="true">Existing loading</div>${body}</main></body></html>`;

test('selected fault routes complete on terminal errors while delays retain their deadline', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-fault-budget-'));
  try {
    await mkdir(path.join(dir, 'dist'));
    await mkdir(path.join(dir, 'logs'));
    const config = normalizeConfig({ repo: dir, web: {
      build: { run: 'true' }, api: { envVar: 'API_URL' },
      routes: [{ name: 'one', path: '#/one' }, { name: 'two', path: '#/two' }],
      viewports: [375], colorSchemes: ['light'], settleMs: 0,
      accessibility: false, keyboard: false, concurrency: 1,
      faultInjection: { routes: ['one'], concurrency: 2, kinds: ['500', 'delay'], delayMs: 5000, timeoutMs: 2500, terminalSelector: '#failed', minObservationMs: 100 },
    } }, { projectName: 'budget' });
    await writeFile(path.join(dir, 'dist/index.html'), `<!doctype html><h1>Items</h1><p id="loading" aria-busy="true">Loading</p><p id="failed" hidden>Failed</p><script>
      fetch('http://api.spotter.test/items').then(r => {
        document.getElementById('loading').remove();
        if (!r.ok) {
          document.getElementById('failed').hidden = false;
          setTimeout(() => { throw Error('seeded late crash'); }, 600);
        }
      });
    </script>`);
    const result = await runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), fixtures: { entries: { 'GET /items': { status: 200, body: '[]' } } } });
    assert.equal(result.summary.pages, 2);
    assert.equal(result.summary.faultVisits, 2);
    assert.deepEqual(result.summary.faultRoutes, ['one']);
    assert.equal(result.summary.faultEarlyCompletions, 1);
    assert.equal(result.summary.faultVisitsFailed, 0);
    assert(result.summary.timings.faultsMs >= 2500);
    assert(result.findings.some(f => f.check === 'fault-crash' && f.where.startsWith('#/one')));
    assert(result.findings.some(f => f.check === 'fault-loading' && f.where.includes('delay')));
    assert(!result.findings.some(f => f.where?.startsWith('#/two')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser depth detects seeded defects as new, preserves session replay, and exercises delays', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-depth-'));
  const api = createServer((request, response) => { response.setHeader('content-type', 'text/plain'); response.end(request.headers['x-session'] || 'anonymous'); });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  try {
    await mkdir(path.join(dir, 'dist'));
    await mkdir(path.join(dir, 'logs'));
    const config = normalizeConfig({ repo: dir, web: {
      build: { run: 'true' }, api: { envVar: 'API_URL', recordFrom: `http://127.0.0.1:${api.address().port}` }, routes: ['/'], viewports: [375], colorSchemes: ['light'], settleMs: 0,
      sessions: [{ name: 'member', localStorage: { session: 'member' }, expectSelector: 'h1' }, { name: 'ghost', localStorage: { session: 'member' }, expectSelector: '#signed-in-only' }],
      faultInjection: { delayMs: 80, timeoutMs: 160 },
    } }, { projectName: 'depth' });
    const fixtures = { entries: { 'GET /data': { status: 200, body: 'anonymous' } }, sessions: { member: { 'GET /data': { status: 200, body: 'member' } } } };
    const run = () => runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), fixtures });
    const script = `<script>fetch('http://api.spotter.test/data', {headers:{'x-session':localStorage.getItem('session') || 'anonymous'}}).then(async r => {
      if (!r.ok) { window.onFailure(); return; }
      const value = await r.text();
      if (value !== (localStorage.getItem('session') || 'anonymous')) throw Error('wrong session fixtures');
      document.querySelector('main').removeAttribute('aria-busy');
    });</script>`;
    await writeFile(path.join(dir, 'dist/index.html'), shell(`<h1>Healthy</h1><button>Save</button><div tabindex="-1">Programmatic focus target</div><input type="radio" name="choice" aria-label="One" checked><input type="radio" name="choice" aria-label="Two"><script>window.onFailure=()=>document.querySelector('main').removeAttribute('aria-busy')</script>${script}`));
    const recordedEntries = { entries: {}, sessions: {} };
    await runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), mode: 'record', recordedEntries });
    assert.equal(recordedEntries.entries['GET /data'].body, 'anonymous');
    assert.equal(recordedEntries.sessions.member['GET /data'].body, 'member');
    Object.assign(fixtures, recordedEntries);
    const healthy = await run();
    assert.equal(healthy.findings.filter((f) => f.severity !== 'low').length, 0, JSON.stringify(healthy.findings));
    assert(!healthy.findings.some((f) => f.check === 'keyboard-reachability'));
    assert.equal(healthy.summary.pages, 3);
    assert.equal(healthy.summary.faultVisits, 6);
    assert.equal(healthy.summary.pagesFailed, 0);
    assert.equal(healthy.summary.faultVisitsFailed, 0);
    const { member, ghost } = healthy.summary.sessionChecks;
    assert(member.checked > 0 && member.failed === 0, JSON.stringify(member));
    assert(ghost.checked > 0 && ghost.failed === ghost.checked && ghost.examples.length > 0, JSON.stringify(ghost));
    assert(ghost.examples[0].includes('[ghost]'));
    assert(!healthy.findings.some((f) => f.where.includes('[ghost]') && f.severity !== 'low'));
    await writeFile(path.join(dir, 'dist/index.html'), shell(`<h1>Seeded</h1><button aria-label="Save"></button><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="><button tabindex="-1">Unreachable</button><div role="button">Custom action</div><script>window.onFailure=()=>{ document.body.innerHTML=''; throw Error('seeded crash'); }</script>${script}`));
    const seeded = await run();
    const fresh = compareWithBaseline(seeded.findings, healthy.findings).newFindings;
    assert(fresh.some((f) => f.check === 'accessibility' && f.title.startsWith('image-alt:') && f.severity === 'medium'));
    assert(fresh.some((f) => f.check === 'keyboard-reachability' && f.detail.includes('Custom action')));
    assert(fresh.some((f) => f.check === 'fault-blank'));
    assert(fresh.some((f) => f.check === 'fault-crash'));
    assert(!fresh.some((f) => f.check === 'unrecorded-request' || f.check === 'api-error'));
    config.web.faultInjection = { delayMs: 500, timeoutMs: 80, loadingSelector: '[aria-busy=true]' };
    await writeFile(path.join(dir, 'dist/index.html'), shell(`<h1 aria-busy="true">Loading</h1><script>window.onFailure=()=>document.querySelector('h1').removeAttribute('aria-busy')</script>${script.replace("document.querySelector('main')", "document.querySelector('h1')")}`));
    const delayed = await run();
    assert(delayed.findings.some((f) => f.check === 'fault-loading' && /delay/.test(f.title) && f.severity === 'low'));
    assert(!delayed.findings.some((f) => f.severity !== 'low'), JSON.stringify(delayed.findings));
    assert(!delayed.findings.some((f) => f.check === 'fault-loading' && /during 500/.test(f.title)));
  } finally {
    await new Promise((resolve) => api.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('healthy layout controls do not become overflow or blank-page findings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-controls-'));
  try {
    await mkdir(path.join(dir, 'dist'));
    await mkdir(path.join(dir, 'logs'));
    const config = normalizeConfig({ repo: dir, web: {
      build: { run: 'true' }, routes: ['/'], viewports: [375], colorSchemes: ['light'],
      settleMs: 0, accessibility: false, keyboard: false, faultInjection: false,
      errorText: ['Something went wrong'],
    } }, { projectName: 'controls' });
    await writeFile(path.join(dir, 'dist/index.html'), shell(`<h1>Healthy</h1>
      <div style="overflow:auto;width:200px"><div style="width:800px">Carousel content</div></div>
      <div style="opacity:0"><div style="width:900px;position:fixed">Invisible content</div></div>
      <div hidden>Something went wrong</div>`));
    const run = () => runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots') });
    assert.deepEqual((await run()).findings, []);
    await writeFile(path.join(dir, 'dist/index.html'), shell('<h1>Healthy</h1><div style="width:900px">Actual overflow</div>'));
    assert((await run()).findings.some((finding) => finding.check === 'horizontal-overflow'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expected API statuses suppress only the listed replayed status; fault visits still run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-expected-'));
  try {
    await mkdir(path.join(dir, 'dist'));
    await mkdir(path.join(dir, 'logs'));
    const config = normalizeConfig({ repo: dir, web: {
      build: { run: 'true' }, api: { envVar: 'API_URL', expectedStatuses: [{ request: 'GET /docs/(library|rules)', status: 404 }] },
      routes: ['/'], viewports: [375], colorSchemes: ['light'], settleMs: 0, accessibility: false, keyboard: false,
      faultInjection: { delayMs: 80, timeoutMs: 160 },
    } }, { projectName: 'expected' });
    await writeFile(path.join(dir, 'dist/index.html'), shell(`<h1>Docs</h1><script>
      Promise.all(['library', 'rules', 'other'].map((name) => fetch('http://api.spotter.test/docs/' + name).then((r) => {
        if (r.status >= 500) { document.body.innerHTML = ''; throw Error('crash on ' + name); }
      }))).finally(() => document.querySelector('main').removeAttribute('aria-busy'));
    </script>`));
    const run = (entries) => runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), fixtures: { entries, sessions: {} } });
    const result = await run({ 'GET /docs/library': { status: 404, body: '' }, 'GET /docs/rules': { status: 409, body: '' }, 'GET /docs/other': { status: 404, body: '' } });
    const apiErrors = result.findings.filter((f) => f.check === 'api-error').map((f) => f.title).sort();
    assert.deepEqual(apiErrors, ['API answered 404: GET /docs/other', 'API answered 409: GET /docs/rules'], JSON.stringify(result.findings));
    assert.equal(result.summary.faultVisits, 6);
    assert(result.findings.some((f) => f.check === 'fault-blank' && f.where.includes('500 GET /docs/library')), JSON.stringify(result.findings));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every fault kind is injected; a resilient app is clean and an unguarded app crashes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-kinds-'));
  try {
    await mkdir(path.join(dir, 'dist'));
    await mkdir(path.join(dir, 'logs'));
    const config = normalizeConfig({ repo: dir, web: {
      build: { run: 'true' }, api: { envVar: 'API_URL' }, routes: ['/'], viewports: [375], colorSchemes: ['light'], settleMs: 0, accessibility: false, keyboard: false,
      errorText: ['Could not load'], faultInjection: { kinds: FAULT_KINDS, delayMs: 80, timeoutMs: 400 },
    } }, { projectName: 'kinds' });
    const run = () => runWebStage({ config, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), fixtures: { entries: { 'GET /items': { status: 200, body: '{"items":["one"]}' } }, sessions: {} } });
    const page = (script) => shell(`<h1>Items</h1><p id="out">Loading</p><script>const render = (data) => { document.querySelector('main').removeAttribute('aria-busy'); document.getElementById('out').textContent = data.items.join(); };
      const showError = () => { document.querySelector('main').removeAttribute('aria-busy'); document.getElementById('out').textContent = 'Could not load'; };
      ${script}</script>`);
    await writeFile(path.join(dir, 'dist/index.html'), page("fetch('http://api.spotter.test/items').then((r) => r.ok ? r.json() : Promise.reject(r.status)).then(render).catch(showError);"));
    const healthy = await run();
    assert.equal(healthy.summary.faultVisits, 7);
    assert.equal(healthy.summary.faultVisitsFailed, 0);
    assert.equal(healthy.findings.filter((f) => f.severity !== 'low').length, 0, JSON.stringify(healthy.findings));
    assert(!healthy.findings.some((f) => f.check === 'api-error' || f.check === 'unrecorded-request'), JSON.stringify(healthy.findings));
    await writeFile(path.join(dir, 'dist/index.html'), page("fetch('http://api.spotter.test/items').then((r) => r.json()).then(render);"));
    const seeded = await run();
    const fresh = compareWithBaseline(seeded.findings, healthy.findings).newFindings;
    for (const kind of ['abort', 'malformed']) {
      assert(fresh.some((f) => f.check === 'fault-crash' && f.title === `page crashes during ${kind} response`), `${kind}: ${JSON.stringify(seeded.findings)}`);
    }
    assert(!fresh.some((f) => f.check === 'api-error' || f.check === 'unrecorded-request'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

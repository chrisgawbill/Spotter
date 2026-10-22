import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createDashboardServer, startDashboard } from '../src/dashboard.mjs';
import { createActivity } from '../src/activity.mjs';

// Exercises the HTTP trust boundary, persistent activity, old reports and child failure handling.
test('dashboard launches only listed branches, follows activity and confines report artifacts', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-dashboard-'));
  let launched;
  let child;
  const server = createDashboardServer({ home, projectNames: async () => ['demo'],
    loadConfig: async () => ({ repo: path.resolve('.'), baseBranch: 'main' }),
    launch: (...args) => { launched = args; child = new EventEmitter(); child.pid = process.pid; return child; },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (url, options) => fetch(`${origin}${url}`, options);
  const post = (data, headers = {}) => get('/api/runs', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    const projects = await (await get('/api/projects')).json();
    const branch = projects[0].branches[0];
    assert.ok(branch);
    assert.equal((await post({ project: 'demo', branch }, { Origin: 'http://outside.example' })).status, 403);
    assert.equal((await post({ project: '../demo', branch })).status, 400);
    assert.equal((await post({ project: 'demo', branch }, { Host: 'outside.example', Origin: 'http://outside.example' })).status, 403);
    assert.equal((await post({ project: 'demo', branch: '--help; touch /tmp/never' })).status, 400);
    const response = await post({ project: 'demo', branch });
    assert.equal(response.status, 202);
    const { id } = await response.json();
    assert.deepEqual(launched[1].slice(-4), ['run', 'demo', '--ref', branch]);
    assert.equal((await post({ project: 'demo', branch })).status, 409);
    const directory = path.join(home, 'demo/runs', id);
    const activity = createActivity(directory, { project: 'demo', branch });
    activity.event('head', 'check: types');
    activity.event('head', 'check: types', 'done');
    activity.event('head', 'browser: /demo [anonymous] @375 light');
    const runURL = `/api/runs/demo/${id}`;
    const running = await (await get(runURL)).json();
    assert.equal(running.status, 'running');
    assert.equal(running.events.length, 3);
    assert.equal(running.current.length, 1);
    assert.match(running.current[0].activity, /browser:/);
    assert.ok(running.updatedAt);
    await writeFile(path.join(directory, 'report.json'), JSON.stringify({ head: { label: branch, stages: { static: [] } }, comparison: { newFindings: [] } }));
    await writeFile(path.join(directory, 'report.html'), '<h1>Report</h1><img src="screenshots/test.png">');
    await mkdir(path.join(directory, 'screenshots'));
    await writeFile(path.join(directory, 'screenshots/test.png'), 'png');
    const completed = await (await get(runURL)).json();
    assert.equal(completed.status, 'pass');
    assert.ok(completed.report);
    const report = await get(completed.report);
    assert.match(report.headers.get('content-security-policy'), /sandbox/);
    assert.match(await report.text(), /Report/);
    assert.deepEqual((await (await get(completed.report.replace('report.html', 'report.json'))).json()).comparison.newFindings, []);
    await mkdir(path.join(directory, 'logs'));
    await writeFile(path.join(directory, 'logs/build.log'), 'build output');
    assert.match(await (await get(completed.report.replace('report.html', 'logs/'))).text(), /build.log/);
    assert.equal((await get(completed.report.replace('report.html', 'screenshots/test.png'))).status, 200);
    await symlink(path.join(home, 'outside.log'), path.join(directory, 'escape.log'));
    await writeFile(path.join(home, 'outside.log'), 'private');
    assert.equal((await get(completed.report.replace('report.html', 'escape.log'))).status, 404);
    assert.equal((await get('/artifacts/demo/latest/report.html')).status, 404);
    assert.equal((await get('/demo/fixtures/api.json')).status, 404);
    assert.equal((await get('/core.css')).status, 200);
    assert.match(await (await get('/')).text(), /Spotter/);
    child.emit('exit', 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const failure = await (await post({ project: 'demo', branch })).json();
    child.emit('exit', 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await (await get(`/api/runs/demo/${failure.id}`)).json()).status, 'error');
    const stale = path.join(home, 'demo/runs/stale');
    await mkdir(stale);
    await writeFile(path.join(stale, 'activity.json'), JSON.stringify({ branch, status: 'running', updatedAt: '2000-01-01T00:00:00Z' }));
    assert.equal((await (await get('/api/runs/demo/stale')).json()).status, 'error');
    activity.finish('pass');
    const runs = await (await get('/api/runs')).json();
    assert.equal(runs.length, 3);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test('dashboard requires an explicit Tailscale address', async () => {
  const before = process.env.SPOTTER_TAILSCALE_IP;
  try {
    for (const host of ['', '0.0.0.0', '127.0.0.1', '192.168.1.2', '100.63.1.1', '100.128.1.1']) {
      process.env.SPOTTER_TAILSCALE_IP = host;
      await assert.rejects(startDashboard, /Tailscale IPv4/);
    }
  } finally {
    if (before === undefined) delete process.env.SPOTTER_TAILSCALE_IP;
    else process.env.SPOTTER_TAILSCALE_IP = before;
  }
});

test('config editor validates YAML, preserves comments, detects stale edits and confines writes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotter-config-editor-'));
  const server = createDashboardServer({ configsDir: directory });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (name, method = 'GET', data, headers = {}) => fetch(`${origin}/api/${name}`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const source = '# Keep this comment\nrepo: /tmp/example\nbaseBranch: main\n';
  try {
    assert.equal((await request('configs/demo', 'PUT', { source, previous: null }, { Origin: 'http://outside.example' })).status, 403);
    assert.equal((await request('configs/%2e%2e%2fescape', 'PUT', { source, previous: null })).status, 400);
    assert.equal((await request('configs/demo', 'PUT', { source: 'repo: relative', previous: null })).status, 400);
    assert.equal((await request('configs/demo', 'PUT', { source: 'web: [', previous: null })).status, 400);
    assert.equal((await request('configs/demo', 'PUT', { source, previous: null })).status, 200);
    assert.equal((await (await request('configs/demo')).json()).source, source);
    assert.equal((await request('configs/demo', 'PUT', { source, previous: null })).status, 409);
    const draft = await (await request('config-draft', 'POST', { source, fields: { repo: '/tmp/new', baseBranch: 'develop', workdir: '.', install: '' } })).json();
    assert.match(draft.source, /# Keep this comment/);
    assert.equal(draft.fields.repo, '/tmp/new');
    assert.equal((await request('configs/demo', 'PUT', { source: draft.source, previous: source })).status, 200);
    assert.equal((await request('configs/demo', 'DELETE', { previous: source })).status, 409);
    assert.equal((await request('configs/demo', 'DELETE', { previous: draft.source })).status, 200);
    assert.equal((await request('configs/demo')).status, 404);
    await symlink(path.join(directory, 'missing'), path.join(directory, 'linked.yml'));
    assert.equal((await request('configs/linked', 'PUT', { source, previous: null })).status, 400);
    assert.equal((await request('configs/big', 'PUT', { source: 'x'.repeat(262145), previous: null })).status, 413);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

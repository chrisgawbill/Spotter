import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createDashboardServer, fixtureAdvice, startDashboard } from '../src/dashboard.mjs';
import YAML from 'yaml';
import { createActivity } from '../src/activity.mjs';

// Exercises the HTTP trust boundary, persistent activity, old reports and child failure handling.
test('dashboard launches only listed branches, follows activity and confines report artifacts', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-dashboard-'));
  let launched;
  let child;
  const pdfCalls = [];
  const server = createDashboardServer({ branchRefreshMs: 0, home, renderPdf: async (file, root) => { pdfCalls.push([file, root]); return Buffer.from('%PDF-fake'); }, projectNames: async () => ['demo'],
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
    assert.equal((await get('/api/plan?project=demo&level=low')).status, 400);
    assert.equal((await post({ project: 'demo', branch }, { Origin: 'http://outside.example' })).status, 403);
    assert.equal((await post({ project: '../demo', branch })).status, 400);
    assert.equal((await post({ project: 'demo', branch }, { Host: 'outside.example', Origin: 'http://outside.example' })).status, 403);
    assert.equal((await post({ project: 'demo', branch: '--help; touch /tmp/never' })).status, 400);
    const response = await post({ project: 'demo', branch });
    assert.equal(response.status, 202);
    const { id } = await response.json();
    assert.deepEqual(launched[1].slice(-4), ['run', 'demo', '--ref', branch]);
    assert.equal(launched[2].env.HOME, path.join(tmpdir(), 'home'), 'runs get a writable HOME, not the SSH home');
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
    await writeFile(path.join(directory, 'report.html'), '<h1>Report</h1><p><a href="report.md">Markdown</a> · <a href="report.json">JSON</a> · <a href="logs/">Logs</a></p>\n<img src="screenshots/test.png">');
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
    assert.match(await (await get(completed.report)).text(), /href="logs\/"/);
    assert.equal(await (await get(`${completed.report}?embed`)).text(), '<h1>Report</h1><img src="screenshots/test.png">');
    await symlink(path.join(home, 'outside.log'), path.join(directory, 'escape.log'));
    await writeFile(path.join(home, 'outside.log'), 'private');
    assert.equal((await get(completed.report.replace('report.html', 'escape.log'))).status, 404);
    assert.equal((await get('/artifacts/demo/latest/report.html')).status, 404);
    const pdf = await get(completed.report.replace('report.html', 'report.pdf'));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.headers.get('content-disposition'), `attachment; filename="spotter-demo-${id}.pdf"`);
    assert.match(pdf.headers.get('content-security-policy'), /sandbox/);
    assert.equal(await pdf.text(), '%PDF-fake');
    const realRoot = await realpath(directory);
    assert.deepEqual(pdfCalls, [[path.join(realRoot, 'report.html'), realRoot]]);
    await mkdir(path.join(home, 'demo/runs/bare'));
    assert.equal((await get('/artifacts/demo/bare/report.pdf')).status, 404);
    assert.equal((await get('/artifacts/demo/latest/report.pdf')).status, 404);
    assert.equal((await get('/artifacts/demo/../report.pdf')).status, 404);
    assert.equal(pdfCalls.length, 1);
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
    for (const [id, status] of [['gap', 'incomplete'], ['whole', 'complete']]) {
      const seeded = path.join(home, 'demo/runs', id);
      await mkdir(seeded);
      const completeness = { status, gaps: status === 'incomplete' ? ['specs: selected zero tests'] : [], items: [], counts: { pages: null, specs: null }, fixtures: null, baseline: { status: 'none' } };
      await writeFile(path.join(seeded, 'report.json'), JSON.stringify({ head: { label: branch, stages: {} }, comparison: { newFindings: [] }, completeness }));
    }
    const gap = await (await get('/api/runs/demo/gap')).json();
    assert.equal(gap.status, 'incomplete');
    assert.match(gap.coverage, /^INCOMPLETE · baseline none/);
    assert.deepEqual(gap.gaps, ['specs: selected zero tests']);
    const whole = await (await get('/api/runs/demo/whole')).json();
    assert.equal(whole.status, 'pass');
    assert.match(whole.coverage, /^COMPLETE/);
    assert.equal((await (await get(`/api/runs/demo/${id}`)).json()).gaps.length, 0);
    activity.finish('pass');
    const runs = await (await get('/api/runs')).json();
    assert.equal(runs.length, 5);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test('dashboard validates levels, previews the plan and launches with --level', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-levels-'));
  const launched = [];
  const server = createDashboardServer({ branchRefreshMs: 0, home, projectNames: async () => ['demo'],
    loadConfig: async () => ({ name: 'demo', repo: path.resolve('.'), baseBranch: 'main', checks: [], coverage: { required: [] }, web: null, levels: { default: null, low: { routes: ['home'], specs: null } } }),
    launch: (...args) => { launched.push(args); const child = new EventEmitter(); child.pid = process.pid; return child; },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (url) => fetch(`${origin}${url}`);
  const post = (data) => fetch(`${origin}/api/runs`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    const plan = await get('/api/plan?project=demo&level=low');
    assert.equal(plan.status, 200);
    assert.match((await plan.json()).summary, /^level low \(selected\)/);
    assert.equal((await get('/api/plan?project=demo&level=bogus')).status, 400);
    assert.equal((await get('/api/plan?project=nope&level=low')).status, 404);
    const [project] = await (await get('/api/projects')).json();
    assert.deepEqual(project.levels, { default: null, low: true });
    const branch = project.branches[0];
    assert.equal((await post({ project: 'demo', branch, level: 'bogus' })).status, 400);
    assert.equal(launched.length, 0);
    assert.equal((await post({ project: 'demo', branch, level: 'low' })).status, 202);
    assert.deepEqual(launched[0][1].slice(-4), ['--ref', branch, '--level', 'low']);
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

test('dashboard serves its app manifest and accepts only a configured HTTPS tailnet origin', async () => {
  for (const origin of ['http://box.tail1.ts.net', 'https://example.com', 'https://box.tail1.ts.net/path', 'not a url']) {
    assert.throws(() => createDashboardServer({ branchRefreshMs: 0, env: { SPOTTER_DASHBOARD_ORIGIN: origin } }));
  }
  const https = 'https://box.tail1.ts.net:9944';
  const server = createDashboardServer({ branchRefreshMs: 0, home: await mkdtemp(path.join(tmpdir(), 'spotter-pwa-')), projectNames: async () => [], env: { SPOTTER_DASHBOARD_ORIGIN: https } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // fetch() ignores a custom Host header, so send these through node:http.
  const post = (headers) => new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(JSON.stringify({ project: '../x', branch: 'main' }));
  });
  try {
    const manifest = await fetch(`${origin}/manifest.webmanifest`);
    assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
    const { start_url, display, icons } = await manifest.json();
    assert.deepEqual([start_url, display], ['/', 'standalone']);
    for (const icon of icons) assert.equal((await fetch(`${origin}${icon.src}`)).headers.get('content-type'), icon.type);
    assert.equal((await fetch(`${origin}/apple-touch-icon.png`)).headers.get('content-type'), 'image/png');
    // Reaching validation (400) means the host and origin were accepted.
    assert.equal(await post({ Host: 'box.tail1.ts.net:9944', Origin: https }), 400);
    assert.equal(await post({ Host: 'box.tail1.ts.net:9944', Origin: 'http://box.tail1.ts.net:9944' }), 403);
    assert.equal(await post({ Host: 'box.tail1.ts.net', Origin: 'https://box.tail1.ts.net' }), 403);
    assert.equal(await post({ Origin: https }), 403);
    assert.equal(await post({ Origin: origin }), 400);
    assert.deepEqual(await (await fetch(`${origin}/api/app`)).json(), { httpsOrigin: https, locked: true, paddockOrigin: null });
    assert.equal((await fetch(`${origin}/api/app`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ httpsOrigin: '' }) })).status, 409);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Settings saves the HTTPS address, applies it immediately and keeps it across restarts', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-app-'));
  const saved = 'https://box.tail1.ts.net:8444';
  const listen = async () => {
    const server = createDashboardServer({ branchRefreshMs: 0, home, projectNames: async () => [], env: {} });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return [server, `http://127.0.0.1:${server.address().port}`];
  };
  const close = async (server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  let [server, origin] = await listen();
  const put = (httpsOrigin, headers = {}) => fetch(`${origin}/api/app`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ httpsOrigin }) });
  const post = (headers) => new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(JSON.stringify({ project: '../x', branch: 'main' }));
  });
  try {
    assert.deepEqual(await (await fetch(`${origin}/api/app`)).json(), { httpsOrigin: null, locked: false, paddockOrigin: null });
    assert.equal(await post({ Host: 'box.tail1.ts.net:8444', Origin: saved }), 403);
    assert.equal((await put(saved, { Origin: 'http://outside.example' })).status, 403);
    assert.equal((await put('https://example.com')).status, 400);
    assert.equal((await put(saved)).status, 200);
    assert.equal(await post({ Host: 'box.tail1.ts.net:8444', Origin: saved }), 400);
    await close(server);
    [server, origin] = await listen();
    assert.deepEqual(await (await fetch(`${origin}/api/app`)).json(), { httpsOrigin: saved, locked: false, paddockOrigin: null });
    assert.equal(await post({ Host: 'box.tail1.ts.net:8444', Origin: saved }), 400);
    assert.equal((await put('')).status, 200);
    assert.equal(await post({ Host: 'box.tail1.ts.net:8444', Origin: saved }), 403);
  } finally { await close(server); }
});

test('runs of a committed branch link to the saved Paddock address', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-paddock-'));
  const server = createDashboardServer({ branchRefreshMs: 0, home, projectNames: async () => ['demo'], env: { SPOTTER_DASHBOARD_ORIGIN: 'https://box.tail1.ts.net:8444' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const put = (body) => fetch(`${origin}/api/app`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const run = async (id) => (await (await fetch(`${origin}/api/runs/demo/${id}`)).json()).paddock;
  for (const [id, activity] of [['flagged', { branch: 'origin/fix x', handoff: true }], ['working', { branch: 'origin/main' }]]) {
    await mkdir(path.join(home, 'demo/runs', id), { recursive: true });
    await writeFile(path.join(home, 'demo/runs', id, 'activity.json'), JSON.stringify({ ...activity, status: 'running', updatedAt: new Date().toISOString() }));
  }
  try {
    assert.equal(await run('flagged'), null);
    assert.equal((await put({ paddockOrigin: 'javascript:alert(1)' })).status, 400);
    assert.equal((await put({ httpsOrigin: '' })).status, 409);
    const saved = await (await put({ paddockOrigin: 'https://box.tail1.ts.net:8445/' })).json();
    assert.deepEqual(saved, { httpsOrigin: 'https://box.tail1.ts.net:8444', locked: true, paddockOrigin: 'https://box.tail1.ts.net:8445' });
    assert.equal(await run('flagged'), 'https://box.tail1.ts.net:8445/#start/demo/origin%2Ffix%20x');
    assert.equal(await run('working'), null, 'working-tree, --repo and older runs get no link');
    assert.equal((await put({ paddockOrigin: '' })).status, 200);
    assert.equal(await run('flagged'), null);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('config editor validates YAML, preserves comments, detects stale edits and confines writes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotter-config-editor-'));
  const server = createDashboardServer({ branchRefreshMs: 0, configsDir: directory });
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


test('dashboard periodically fetches new remote branches and prunes deleted ones without changing local branches', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotter-remote-branches-'));
  const remote = path.join(directory, 'remote.git');
  const repo = path.join(directory, 'repo');
  const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
  git('init', '--bare', remote);
  git('init', '-b', 'main', repo);
  git('-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial');
  git('-C', repo, 'remote', 'add', 'origin', remote);
  git('-C', repo, 'push', 'origin', 'main', 'main:stale');
  const server = createDashboardServer({ branchRefreshMs: 50, projectNames: async () => ['demo'], loadConfig: async () => ({ repo, baseBranch: 'main' }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/projects`;
  async function waitForBranches(check) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [project] = await (await fetch(url)).json();
      if (check(project.branches)) return project;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('Remote branch list did not refresh');
  }
  try {
    await waitForBranches((names) => names.includes('origin/stale'));
    git('--git-dir', remote, 'update-ref', 'refs/heads/new', git('-C', repo, 'rev-parse', 'HEAD').toString().trim());
    git('--git-dir', remote, 'update-ref', '-d', 'refs/heads/stale');
    const project = await waitForBranches((names) => names.includes('origin/new') && !names.includes('origin/stale'));
    assert.ok(project.branches.includes('main'));
    assert.equal(git('-C', repo, 'branch', '--show-current').toString().trim(), 'main');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    // Let an in-flight fetch exit before removing its repository.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rm(directory, { recursive: true, force: true });
  }
});


test('folder setup drafts nested apps without executing scripts and confines browsing to the projects root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'spotter-setup-'));
  const repo = path.join(root, 'sample');
  const app = path.join(repo, 'frontend');
  await mkdir(app, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial');
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { build: 'vite build', test: 'vitest', lint: 'eslint .', typecheck: 'tsc --noEmit', 'format:check': 'prettier --write .' }, devDependencies: { vite: '*', vitest: '*' } }));
  await symlink(tmpdir(), path.join(root, 'escape'));
  const server = createDashboardServer({ projectsRoot: root, branchRefreshMs: 0, projectNames: async () => [] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const setup = (folder, headers = {}) => fetch(`${origin}/api/project-setup`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ folder }) });
  try {
    const listing = await (await fetch(`${origin}/api/project-folders`)).json();
    assert.equal(listing.parent, null);
    assert.deepEqual(listing.folders.map((entry) => entry.name), ['sample']);
    assert.equal((await fetch(`${origin}/api/project-folders?folder=${encodeURIComponent(tmpdir())}`)).status, 400);
    assert.equal((await setup(path.join(root, 'escape'))).status, 400);
    assert.equal((await setup(app, { Origin: 'http://outside.example' })).status, 403);
    const draft = await (await setup(app)).json();
    assert.match(draft.source, /- \{ name: home, path: \/ \}/);
    assert.match(draft.source, /viewports: \[ 375, 1280 \]/);
    assert.match(draft.source, /colorSchemes: \[ light, dark \]/);
    const config = YAML.parse(draft.source);
    assert.equal(config.repo, repo);
    assert.equal(config.workdir, 'frontend');
    assert.equal(config.baseBranch, 'main');
    assert.equal(config.install, 'pnpm install');
    assert.equal(config.checks.find((check) => check.name === 'test').run, 'pnpm run test --run --reporter=json --outputFile={output}');
    assert.equal(config.checks.find((check) => check.name === 'test').parser, 'vitest');
    assert.ok(!config.checks.some((check) => check.name === 'format:check'));
    assert.equal(config.web.build.outDir, 'dist');
    assert.deepEqual(config.web.routes, [{ name: 'home', path: '/' }]);
    assert.ok(draft.notes.some((note) => note.includes('Skipped format:check')));
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ private: true, workspaces: ['frontend'] }));
    const minimal = YAML.parse((await (await setup(repo)).json()).source);
    assert.equal(minimal.workdir, 'frontend');
    assert.equal(minimal.web.build.outDir, 'dist');
    await writeFile(path.join(app, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint . --fix', test: 'node --test' } }));
    await writeFile(path.join(app, 'package-lock.json'), '{}');
    const npm = YAML.parse((await (await setup(app)).json()).source);
    assert.equal(npm.install, 'npm ci');
    assert.deepEqual(npm.checks.map((check) => check.name), ['test']);
    assert.equal(npm.web, undefined);
    await writeFile(path.join(app, 'package.json'), JSON.stringify({ scripts: { build: 'next build' }, dependencies: { next: '*' } }));
    await writeFile(path.join(app, 'next.config.ts'), "export default { output: 'export', basePath: '/portal' };");
    await mkdir(path.join(app, 'app/about'), { recursive: true });
    await writeFile(path.join(app, 'app/about/page.tsx'), 'export default function Page() { return <h1>About</h1>; }');
    const next = YAML.parse((await (await setup(app)).json()).source);
    assert.equal(next.web.build.outDir, 'out');
    assert.equal(next.web.base, '/portal');
    assert.deepEqual(next.web.routes.map((route) => route.path), ['/about']);
    await writeFile(path.join(app, 'next.config.ts'), "export default { output: 'standalone' };");
    const serverApp = await (await setup(app)).json();
    assert.equal(YAML.parse(serverApp.source).web, undefined);
    assert.match(serverApp.notes.join(' '), /Discovered route URLs: \/about/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('storage API reports usage, saves retention settings and cleans up old runs', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-storage-'));
  const runs = path.join(home, 'demo/runs');
  for (const day of ['01', '02', '03']) {
    const id = `202401${day}-run`;
    await mkdir(path.join(runs, id), { recursive: true });
    await writeFile(path.join(runs, id, 'activity.json'), JSON.stringify({ status: 'done', startedAt: `2024-01-${day}T00:00:00Z` }));
  }
  await symlink('20240101-run', path.join(runs, 'latest'));
  await mkdir(path.join(home, 'demo/baselines/one'), { recursive: true });
  await writeFile(path.join(home, 'demo/baselines/one/side.json'), '{}');
  const start = async (env) => {
    const server = createDashboardServer({ branchRefreshMs: 0, home, env, projectNames: async () => ['demo'], loadConfig: async () => ({}) });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = (url, method = 'GET', data, headers = {}) => fetch(origin + url, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { server, call };
  };
  const stop = ({ server }) => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); };
  const plain = await start({});
  try {
    const storage = await (await plain.call('/api/storage')).json();
    assert.deepEqual(storage.settings, { keepRuns: 10, keepBaselines: 5, autoPrune: true });
    assert.deepEqual(storage.locked, { keepRuns: false, keepBaselines: false, autoPrune: false });
    assert.equal(storage.projects[0].name, 'demo');
    assert.equal(storage.projects[0].runs.count, 3);
    assert.equal(storage.projects[0].baselines.count, 1);
    const body = { keepRuns: 1, keepBaselines: 5, autoPrune: false };
    assert.equal((await plain.call('/api/retention', 'PUT', body, { Origin: 'http://outside.example' })).status, 403);
    assert.equal((await plain.call('/api/retention', 'PUT', { ...body, keepRuns: -1 })).status, 400);
    assert.equal((await plain.call('/api/retention', 'PUT', body)).status, 200);
    assert.deepEqual((await (await plain.call('/api/storage')).json()).settings, body);
    assert.equal((await plain.call('/api/cleanup', 'POST', {}, { Origin: 'http://outside.example' })).status, 403);
    const cleanup = await plain.call('/api/cleanup', 'POST', {});
    assert.equal(cleanup.status, 200);
    assert.deepEqual(await cleanup.json(), { removed: 1, skipped: [] });
    assert.deepEqual((await readdir(runs)).sort(), ['20240101-run', '20240103-run', 'latest']);
  } finally { await stop(plain); }
  const locked = await start({ SPOTTER_KEEP_RUNS: '3' });
  try {
    const storage = await (await locked.call('/api/storage')).json();
    assert.equal(storage.settings.keepRuns, 3);
    assert.equal(storage.locked.keepRuns, true);
  } finally {
    await stop(locked);
    await rm(home, { recursive: true, force: true });
  }
});

test('run form advice shows the server record command when fixtures are missing or incomplete', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'spotter-fixture-advice-'));
  const api = { paths: ['/api'], recordFrom: 'http://localhost:5209', backend: null };
  const config = { name: 'shop', web: { api } };
  assert.equal(await fixtureAdvice(home, { name: 'shop', web: { api: null } }, 'main'), null);
  assert.deepEqual(await fixtureAdvice(home, config, 'feature/x'), {
    reason: 'No API fixtures are recorded yet, so this run will be incomplete.',
    command: 'bin/spotter record shop --ref feature/x',
  });
  assert.equal((await fixtureAdvice(home, { name: 'shop', web: { api: { ...api, backend: { run: 'x' } } } }, "it's")).command, "bin/spotter record shop --ref 'it'\\''s' --host-backend");
  await mkdir(path.join(home, 'shop/fixtures'), { recursive: true });
  await writeFile(path.join(home, 'shop/fixtures/api.json'), '{}');
  assert.equal(await fixtureAdvice(home, config, 'main'), null);
  const report = (check) => JSON.stringify({ head: { label: 'feature/x' }, comparison: { newFindings: [{ check }], existingFindings: [] } });
  await mkdir(path.join(home, 'shop/runs/20261023-100000-a'), { recursive: true });
  await writeFile(path.join(home, 'shop/runs/20261023-100000-a/report.json'), report('unrecorded-request'));
  assert.deepEqual(await fixtureAdvice(home, config, 'main'), {
    reason: 'The last run (feature/x) called API endpoints the fixtures do not have.',
    command: 'bin/spotter record shop --ref main --merge',
  });
  await mkdir(path.join(home, 'shop/runs/20261023-110000-b'), { recursive: true });
  await writeFile(path.join(home, 'shop/runs/20261023-110000-b/report.json'), report('console-error'));
  assert.equal(await fixtureAdvice(home, config, 'main'), null, 'only the newest finished run counts');
});

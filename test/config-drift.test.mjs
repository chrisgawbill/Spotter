import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareWithInference, findIneffectiveSchemes, inferWebSettings } from '../src/config-drift.mjs';

const inferred = {
  colorSchemeStorage: { light: { 'app:theme': 'light' }, dark: { 'app:theme': 'dark' } },
  routes: [{ name: 'home', path: '/' }, { name: 'reports', path: '/#reports' }, { name: 'matchup', path: '#/matchup' }],
  apiPaths: ['/api'],
  specFiles: ['qa/journeys.spec.mjs'],
};

test('missing inferred settings each become one low config finding with suggested YAML', () => {
  const findings = compareWithInference({ routes: [{ name: 'home', path: '/' }], api: null }, inferred);
  assert.deepEqual(findings.map((finding) => finding.title), [
    'config lacks inferred web.colorSchemeStorage',
    'config lacks inferred web.routes /#reports',
    'config lacks inferred web.routes #/matchup',
    'config lacks inferred web.api.paths /api',
    'config lacks inferred web.specs.files qa/journeys.spec.mjs',
  ]);
  assert.ok(findings.every((finding) => finding.stage === 'config' && finding.check === 'setup-inference' && finding.severity === 'low'));
  assert.match(findings[0].detail, /web:\n {2}colorSchemeStorage:\n {4}light:\n {6}app:theme: light/);
  assert.match(findings[1].detail, /routes:\n {4}- name: reports\n {6}path: \/#reports/);
  assert.match(findings[4].detail, /specs:\n {4}files:\n {6}- qa\/journeys\.spec\.mjs/);
});

test('present settings are not reported, even with different values; routes match without query', () => {
  const web = {
    colorSchemeStorage: { light: { theme: 'day' }, dark: { theme: 'night' } },
    routes: [{ name: 'home', path: '/' }, { name: 'reports', path: '#reports' }, { name: 'matchup', path: '#/matchup?teamA=TOR' }],
    api: { paths: ['/api'] },
    specs: { files: [], live: { files: ['qa/journeys.spec.mjs'] } },
  };
  assert.deepEqual(compareWithInference(web, inferred), []);
});

test('config finding keys depend on setting and value only', () => {
  const first = compareWithInference({ routes: [], api: null }, inferred);
  const second = compareWithInference({ routes: [{ name: 'other', path: '/#other' }], api: { paths: ['/other'] } }, { ...inferred, colorSchemeStorage: { ...inferred.colorSchemeStorage } });
  assert.deepEqual(second.map((finding) => finding.id), first.map((finding) => finding.id));
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
});

test('inference reads the exported tree without installs and skips legacy hash aliases', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'spotter-drift-'));
  try {
    await mkdir(path.join(root, 'app', 'src'), { recursive: true });
    await mkdir(path.join(root, 'app', 'node_modules', 'x'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['app'] }));
    await writeFile(path.join(root, 'app', 'package.json'), JSON.stringify({ devDependencies: { vite: '5' } }));
    await writeFile(path.join(root, 'app', 'node_modules', 'x', 'index.js'), `if (location.hash === '#from-deps') {}`);
    await writeFile(path.join(root, 'app', 'vite.config.ts'), `export default { server: { proxy: { '/api': 'http://localhost:5000' } } };`);
    await writeFile(path.join(root, 'app', 'src', 'App.tsx'), `
      const scheme = localStorage.getItem('app:theme') === 'dark' ? 'dark' : 'light';
      if (location.hash === '#old') history.replaceState(null, '', '#reports');
      if (location.hash === '#reports') show();
    `);
    await mkdir(path.join(root, 'app', 'qa'));
    await writeFile(path.join(root, 'app', 'qa', 'journeys.spec.mjs'), 'const { test } = await import(process.env.SPOTTER_TEST_MODULE);');
    await writeFile(path.join(root, 'app', 'qa', 'login.live.spec.mjs'), 'const { test } = await import(process.env.SPOTTER_TEST_MODULE);');
    await writeFile(path.join(root, 'app', 'qa', 'plain.spec.mjs'), "import { test } from '@playwright/test';");
    const settings = await inferWebSettings(root, path.join(root, 'app'));
    assert.deepEqual(settings.specFiles, ['qa/journeys.spec.mjs']);
    assert.deepEqual(settings.colorSchemeStorage, inferred.colorSchemeStorage);
    assert.deepEqual(settings.routes, [{ name: 'home', path: '/' }, { name: 'reports', path: '/#reports' }]);
    assert.deepEqual(settings.apiPaths, ['/api']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('colour schemes with byte-identical screenshots on every visit of a route are reported once per route', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'spotter-schemes-'));
  try {
    const home = { name: 'home', path: '/' };
    const about = { name: 'about', path: '/about' };
    const session = { name: 'anonymous' };
    const visit = async (route, width, colorScheme, bytes) => {
      const screenshot = path.join(folder, `${route.name}-${width}-${colorScheme}.png`);
      await writeFile(screenshot, bytes);
      return { job: { route, viewport: { width }, colorScheme, session }, screenshot };
    };
    const results = [
      await visit(home, 375, 'light', 'same'), await visit(home, 375, 'dark', 'same'),
      await visit(home, 1280, 'light', 'wide'), await visit(home, 1280, 'dark', 'wide'),
      await visit(about, 375, 'light', 'same'), await visit(about, 375, 'dark', 'same'),
      await visit(about, 1280, 'light', 'light'), await visit(about, 1280, 'dark', 'dark'),
      { job: { route: about, viewport: { width: 768 }, colorScheme: 'dark', session }, screenshot: null },
    ];
    const findings = await findIneffectiveSchemes({ routes: [home, about], colorSchemes: ['light', 'dark'] }, results);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].title, 'light and dark colour schemes render identically');
    assert.equal(findings[0].where, '/');
    assert.equal(findings[0].severity, 'low');
    assert.deepEqual(await findIneffectiveSchemes({ routes: [home], colorSchemes: ['light'] }, results), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('identical light and dark screenshots in only one target are not reported as an ineffective scheme', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'spotter-scheme-targets-'));
  try {
    const route = { name: 'home', path: '/' };
    const session = { name: 'anonymous' };
    const visit = async (target, colorScheme, bytes) => {
      const screenshot = path.join(folder, `${target}-${colorScheme}.png`);
      await writeFile(screenshot, bytes);
      return { job: { route, viewport: { width: 375 }, colorScheme, session, target: { id: target } }, screenshot };
    };
    const results = [
      await visit('firefox', 'light', 'light'), await visit('firefox', 'dark', 'dark'),
      await visit('chromium', 'light', 'same'), await visit('chromium', 'dark', 'same'),
    ];
    assert.deepEqual(await findIneffectiveSchemes({ routes: [route], colorSchemes: ['light', 'dark'] }, results), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

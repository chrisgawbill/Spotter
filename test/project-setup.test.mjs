import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { detectProject } from '../src/project-setup.mjs';
import { formatConfig } from '../src/config-yaml.mjs';
import { configFields } from '../src/config-fields.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'spotter-smart-setup-'));
  const repo = path.join(root, 'app');
  const configsDir = path.join(root, 'configs');
  await mkdir(repo); await mkdir(configsDir);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'Initial');
  return { root, repo, configsDir, write: async (file, source) => { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), source); } };
}

test('new projects detect checks, API, themes, retries, responsive widths, sample routes and adapter specs', async () => {
  const f = await fixture();
  try {
    await f.write('package.json', JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { build: 'vite build', test: 'vitest run', 'format:check': 'prettier --check src' }, devDependencies: { vite: '*', typescript: '*', vitest: '*', prettier: '*' } }));
    await f.write('pnpm-lock.yaml', 'lockfileVersion: 9');
    await f.write('tsconfig.json', '{}');
    await f.write('src/App.tsx', `
      import {HashRouter, Route, Link} from 'react-router-dom';
      const api = import.meta.env.VITE_BACKEND_URL || 'https://api.example.test';
      const RETRY_DELAYS = [1000, 2000, 4000];
      const theme = localStorage.getItem('app-theme');
      const choices = ['light', 'dark'];
      export const App = () => <HashRouter><Route path="/" /><Route path="teams/:id" />
        <Link to="/teams/ABC?season=2026" /><Link to="/teams/ABC?token=never-copy" />
        <ErrorState title="Something went wrong" /></HashRouter>;
    `);
    await f.write('src/LoadingState.tsx', 'export const Loading = () => <span className="loading-spinner" />;');
    await f.write('src/styles.css', '@media (min-width: 768px) and (max-width: 1024px) { body {} }');
    await f.write('qa/flows.spec.mjs', 'const {test} = await import(process.env.SPOTTER_TEST_MODULE);');
    await f.write('.env', 'PASSWORD=never-copy-private-env');
    const result = await detectProject(f.root, f.repo, { configsDir: f.configsDir });
    const config = YAML.parse(result.source);
    assert.equal(config.install, 'pnpm install --frozen-lockfile');
    assert.ok(config.checks.some((check) => check.parser === 'tsc' && check.run.includes('--noEmit')));
    assert.ok(config.checks.some((check) => check.parser === 'vitest' && check.run.includes('--outputFile={output}')));
    assert.ok(config.checks.some((check) => check.parser === 'prettier'));
    assert.deepEqual(config.web.api, { envVar: 'VITE_BACKEND_URL', recordFrom: 'https://api.example.test' });
    assert.deepEqual(config.web.colorSchemeStorage.dark, { 'app-theme': 'dark' });
    assert.equal(config.web.settleMs, 8000);
    assert.equal(config.web.faultInjection.timeoutMs, 20000);
    assert.ok(config.web.viewports.includes(768) && config.web.viewports.includes(1280));
    assert.deepEqual(config.web.specs.files, ['qa/flows.spec.mjs']);
    assert.ok(config.web.routes.some((route) => route.path === '#/teams/ABC?season=2026'));
    assert.ok(config.web.errorText.includes('Something went wrong'));
    assert.ok(!result.source.includes('never-copy'));
    assert.match(config.web.faultInjection.loadingSelector, /loading-spinner/);
    await f.write('src/App.tsx', 'const api = import.meta.env.VITE_BACKEND_URL;');
    await f.write('.env.example', 'VITE_BACKEND_URL=https://public-api.example.test');
    await f.write('playwright.config.ts', "export default { use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark', navigationTimeout: 45000 } };");
    await f.write('.spotter.yml', "web:\n  keyboard: false\nrules:\n  forbiddenText:\n    - { id: debug, pattern: debug, in: commits, message: Remove debug }\n");
    const portable = await detectProject(f.root, f.repo, { configsDir: f.configsDir });
    const configured = YAML.parse(portable.source);
    assert.equal(configured.web.api.recordFrom, 'https://public-api.example.test');
    assert.deepEqual(configured.web.viewports, [{ width: 1440, height: 900 }]);
    assert.deepEqual(configured.web.colorSchemes, ['dark']);
    assert.equal(configured.web.pageTimeoutMs, 45000);
    assert.equal(configured.web.keyboard, false);
    assert.equal(configured.rules.forbiddenText[0].id, 'debug');
    assert.deepEqual(result.coverage.map((entry) => entry.field), Object.keys(configFields));
    assert.equal(result.coverage.find((entry) => entry.field === 'web.sessions').status, 'review');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('saved settings remain authoritative, comments survive and ambiguous configs require a choice', async () => {
  const f = await fixture();
  try {
    await f.write('package.json', JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '*' } }));
    const explicit = { repo: f.repo, install: 'custom install', checks: [{ name: 'types', run: 'custom check', parser: 'tsc' }], rules: { forbiddenText: [{ id: 'policy', pattern: 'debug', in: 'commits', message: 'No debug commits' }] }, web: { build: { run: 'custom build', outDir: 'output' }, routes: [{ name: 'sample', path: '#/item/actual-id?q=1' }], api: { envVar: 'APP_API', recordFrom: 'https://api.example.test' }, settleMs: 8000, concurrency: 24, sessions: [{ name: 'member', storageState: '/private/session.json' }], faultInjection: { timeoutMs: 20000, loadingSelector: '.spinner' } } };
    const source = '# Keep tuned settings\n' + YAML.stringify(explicit);
    await writeFile(path.join(f.configsDir, 'app.yml'), source);
    const result = await detectProject(f.root, f.repo, { configsDir: f.configsDir });
    const config = YAML.parse(result.source);
    for (const key of ['install', 'checks', 'rules']) assert.deepEqual(config[key], explicit[key]);
    for (const [key, value] of Object.entries(explicit.web)) {
      if (key === 'faultInjection') for (const [setting, expected] of Object.entries(value)) assert.deepEqual(config.web[key][setting], expected);
      else assert.deepEqual(config.web[key], value);
    }
    assert.ok(result.source.includes('# Keep tuned settings'));
    assert.equal(result.previous, source);
    assert.equal(result.existingName, 'app');
    assert.equal(result.coverage.find((entry) => entry.field === 'web.sessions').status, 'preserved');
    assert.equal(await readFile(path.join(f.configsDir, 'app.yml'), 'utf8'), source);
    await writeFile(path.join(f.configsDir, 'other.yml'), source);
    const ambiguous = await detectProject(f.root, f.repo, { configsDir: f.configsDir });
    assert.equal(ambiguous.existingName, undefined);
    assert.deepEqual(ambiguous.existingConfigs.sort(), ['app', 'other']);
    const chosen = await detectProject(f.root, f.repo, { configsDir: f.configsDir, existingName: 'other' });
    assert.equal(chosen.existingName, 'other');
    await assert.rejects(detectProject(f.root, f.repo, { configsDir: f.configsDir, existingName: '../outside' }), /matching/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('generated collection layouts come from dictionary examples and round-trip without changing values', () => {
  const config = { repo: '/project', rules: { importBoundaries: [{ id: 'features', root: 'src', aliases: { '@/': 'src/' }, allow: [{ from: 'a', to: 'b' }] }] }, web: { routes: [{ name: 'home', path: '#/' }], viewports: [375, { width: 1280, height: 900 }], colorSchemes: ['light', 'dark'], colorSchemeStorage: { light: { theme: 'light' }, dark: { theme: 'dark' } }, specs: { files: ['qa/example.spec.mjs'] } } };
  const source = formatConfig(config);
  assert.deepEqual(YAML.parse(source), config);
  assert.match(source, /- \{ name: home, path: "#\/" \}/);
  assert.match(source, /viewports: \[ 375, \{ width: 1280, height: 900 \} \]/);
  assert.match(source, /light: \{ theme: light \}/);
  assert.match(source, /files: \[ qa\/example.spec.mjs \]/);
  assert.match(source, /aliases: \{/);
  assert.match(source, /allow: \[ \{ from: a, to: b \} \]/);
});

async function viteApp(f, viteConfig, app) {
  await f.write('package.json', JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '*' } }));
  await f.write('vite.config.js', viteConfig);
  await f.write('src/main.js', app);
  const result = await detectProject(f.root, f.repo, { configsDir: f.configsDir });
  return { result, config: YAML.parse(result.source) };
}

test('a Vite proxy proposes web.api paths and a single literal target as recordFrom', async () => {
  const f = await fixture();
  try {
    const { result, config } = await viteApp(f, "export default { server: { proxy: { '/api': 'http://127.0.0.1:4010' } } };", "fetch('/api/items');");
    assert.deepEqual(config.web.api, { paths: ['/api'], recordFrom: 'http://127.0.0.1:4010' });
    assert.match(result.coverage.find((entry) => entry.field === 'web.api').evidence, /vite\.config\.js: dev-server proxy for \/api to a literal target/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('two proxy targets propose both paths, no recordFrom and a selection note', async () => {
  const f = await fixture();
  try {
    const { result, config } = await viteApp(f, "export default { server: { proxy: { '/api': 'http://127.0.0.1:4010', '/admin': 'http://127.0.0.1:5209' } } };", 'export {};');
    assert.deepEqual(config.web.api, { paths: ['/api', '/admin'] });
    assert.match(result.notes.join(' '), /Multiple API proxy targets found \(http:\/\/127\.0\.0\.1:4010, http:\/\/127\.0\.0\.1:5209\)/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('relative requests without a proxy or env var add a note and no web.api', async () => {
  const f = await fixture();
  try {
    const { result, config } = await viteApp(f, 'export default {};', "fetch('/api/items');");
    assert.equal(config.web?.api, undefined);
    assert.match(result.notes.join(' '), /Relative API requests found in src\/main\.js \(\/api\/items\) but no API was detected/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('relative requests alongside an env-var API add no relative-request note', async () => {
  const f = await fixture();
  try {
    const { result, config } = await viteApp(f, 'export default {};', "const api = import.meta.env.VITE_API_URL; fetch('/api/items');");
    assert.equal(config.web.api.envVar, 'VITE_API_URL');
    assert.doesNotMatch(result.notes.join(' '), /Relative API requests/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('a proxy frontend in a subfolder links to a Node backend elsewhere in the repository', async () => {
  const f = await fixture();
  try {
    await f.write('web/package.json', JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '*' } }));
    await f.write('web/vite.config.js', "export default { server: { proxy: { '/api': 'http://localhost:4020' } } };");
    await f.write('web/src/main.js', "fetch('/api/items');");
    await f.write('services/server/package.json', JSON.stringify({ scripts: { start: 'node index.js', seed: 'node seed.js' }, dependencies: { express: '*' } }));
    await f.write('services/server/package-lock.json', '{}');
    await f.write('services/server/index.js', "app.get('/healthz', ok); app.listen(4020);");
    const result = await detectProject(f.root, f.repo, { configsDir: f.configsDir });
    const api = YAML.parse(result.source).web.api;
    assert.deepEqual(api.backend, { run: 'cd services/server && npm ci && npm run seed && exec npm run start', readyUrl: 'http://localhost:4020/healthz', timeoutMs: 300000 });
    assert.match(result.coverage.find((entry) => entry.field === 'web.api').evidence, /dev-server proxy for \/api to a literal target.*; backend inferred from services\/server\/package\.json with health route \/healthz, seed script services\/server\/package\.json seed; review the command/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

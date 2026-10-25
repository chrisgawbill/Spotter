import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.mjs';

const config = (specs) => normalizeConfig({
  repo: '/tmp/app',
  web: { build: { run: 'true' }, routes: ['/'], specs },
}, { projectName: 'demo' });

test('project specs accept repository-relative files and reject invalid paths', () => {
  const specs = { files: ['qa/ticket.spec.mjs', 'qa/another.spec.js'] };
  assert.deepEqual(config(specs).web.specs.files, specs.files);
  for (const files of [null, 'qa/ticket.spec.mjs', [null], [1], [''], ['/tmp/outside.spec.mjs'], ['../outside.spec.mjs'], ['qa/../../outside.spec.mjs']]) {
    assert.throws(() => config({ files }), /specs/);
  }
  assert.doesNotThrow(() => config(undefined));
});

test('project spec workers must be positive integers', () => {
  for (const workers of [1, 2, 4]) assert.equal(config({ files: ['qa/test.mjs'], workers }).web.specs.workers, workers);
  for (const workers of [0, -1, 1.5, '2', null, true, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => config({ files: ['qa/test.mjs'], workers }), /workers/);
  }
});

const withCoverage = (coverage, web = {}) => normalizeConfig({
  repo: '/tmp/app',
  checks: [{ name: 'typecheck', run: 'true' }],
  web: { build: { run: 'true' }, routes: ['/'], specs: { files: ['qa/a.spec.mjs'] }, sessions: [{ name: 'member', localStorage: { a: 'b' }, expectSelector: '#me' }], ...web },
  coverage,
}, { projectName: 'demo' });

test('coverage defaults and accepts configured names', () => {
  assert.deepEqual(config(undefined).coverage, { required: [], minSpecs: null });
  const { coverage } = withCoverage({ required: ['typecheck', 'rules', 'web', 'specs', 'member'], minSpecs: 3 });
  assert.deepEqual(coverage, { required: ['typecheck', 'rules', 'web', 'specs', 'member'], minSpecs: 3 });
  assert.deepEqual(withCoverage({}).coverage, { required: [], minSpecs: null });
});

test('coverage rejects unknown names, bad shapes and minSpecs without specs', () => {
  for (const coverage of [[], 'x', null]) assert.throws(() => withCoverage(coverage), /`coverage` must be an object/);
  for (const required of ['web', [1], ['nope'], ['fixtures']]) assert.throws(() => withCoverage({ required }), /coverage\.required/);
  for (const minSpecs of [0, 1.5, '2', -1]) assert.throws(() => withCoverage({ minSpecs }), /coverage\.minSpecs/);
  assert.throws(() => withCoverage({ minSpecs: 1 }, { specs: undefined }), /coverage\.minSpecs/);
  assert.equal(withCoverage({ minSpecs: 1 }).coverage.minSpecs, 1);
});

test('session expectSelector must be a nonempty string', () => {
  for (const expectSelector of ['', '  ', 3, null]) {
    assert.throws(() => withCoverage({}, { sessions: [{ name: 'm', localStorage: {}, expectSelector }] }), /web\.sessions/);
  }
  assert.equal(withCoverage({}).web.sessions[1].expectSelector, '#me');
});

test('levels block is validated and normalized', () => {
  const make = (levels, web = {}) => normalizeConfig({
    repo: '/tmp/app',
    levels,
    web: { build: { run: 'true' }, routes: ['home', { name: 'about', path: '/about' }], specs: { files: ['a.spec.mjs'] }, ...web },
  }, { projectName: 'demo' });
  const bad = (levels, message, web) => assert.throws(() => make(levels, web), (error) => error.message.includes(`- ${message}`));
  const shape = '`levels` must be an object with optional default and low';
  for (const levels of [[], 'x', null, { other: 1 }, { high: {} }]) bad(levels, shape);
  bad({ default: 'fast' }, '`levels.default` must be low, medium or high');
  bad({ default: 'low' }, '`levels.default: low` requires `levels.low`');
  for (const low of [[], 'x', { other: 1 }]) bad({ low }, '`levels.low` accepts routes and specs');
  const routes = '`levels.low.routes` must list configured web route names';
  for (const list of [undefined, [], 'home', ['nope'], ['home', 'home'], [1]]) bad({ low: { routes: list } }, routes);
  assert.throws(() => normalizeConfig({ repo: '/tmp/app', levels: { low: { routes: ['home'] } } }, { projectName: 'demo' }), /levels\.low\.routes/);
  const specs = '`levels.low.specs` needs a string grep and requires `web.specs`';
  for (const value of ['x', {}, { grep: '' }, { grep: 1 }, { grep: 'a', other: 1 }]) bad({ low: { routes: ['home'], specs: value } }, specs);
  bad({ low: { routes: ['home'], specs: { grep: '@smoke' } } }, specs, { specs: undefined });

  assert.equal(make(undefined).levels, null);
  assert.deepEqual(make({ default: 'low', low: { routes: ['about'], specs: { grep: '@smoke' } } }).levels,
    { default: 'low', low: { routes: ['about'], specs: { grep: '@smoke' } } });
  assert.deepEqual(make({ low: { routes: ['home'] } }).levels, { default: null, low: { routes: ['home'], specs: null } });
});

const withApi = (api, web = {}) => normalizeConfig({
  repo: '/tmp/app',
  web: { build: { run: 'true' }, routes: ['/'], api, ...web },
}, { projectName: 'demo' });
const apiMessages = {
  shape: '`web.api` accepts envVar, paths, recordFrom, headers, backend and expectedStatuses',
  needs: '`web.api` needs `envVar` or `paths`',
  envVar: '`web.api.envVar` must be an environment variable name',
  paths: '`web.api.paths` must list unique same-origin path prefixes such as /api (no trailing slash, query or wildcard)',
  recordFrom: '`web.api.recordFrom` must be an http(s) URL',
  headers: '`web.api.headers` must map header names to strings; use ${NAME} for environment values',
  backend: '`web.api.backend` needs a `run` command, an http(s) `readyUrl`, optional positive `timeoutMs`, optional `stop` command and optional boolean `seeded`',
  apiHeaders: '`web.sessions[].apiHeaders` must map header names to strings; use ${NAME} for environment values',
};

test('web.api accepts envVar-only and paths-only and fills defaults', () => {
  assert.deepEqual(withApi({ envVar: 'VITE_API_URL' }).web.api, {
    fakeOrigin: 'http://api.spotter.test', envVar: 'VITE_API_URL', recordFrom: null, headers: {}, paths: [], expectedStatuses: [], backend: null,
  });
  const paths = withApi({ paths: ['/api', '/admin/v1'] }).web.api;
  assert.deepEqual([paths.envVar, paths.paths], [null, ['/api', '/admin/v1']]);
  assert.equal(withApi(undefined).web.api, null);
  const backend = withApi({ paths: ['/api'], backend: { run: 'node server.mjs', readyUrl: 'http://localhost:4010/health' } }).web.api.backend;
  assert.deepEqual(backend, { run: 'node server.mjs', readyUrl: 'http://localhost:4010/health', timeoutMs: 60_000, stop: null });
  assert.equal(withApi({ paths: ['/api'], backend: { run: 'x', readyUrl: 'http://localhost:1/', timeoutMs: 500 } }).web.api.backend.timeoutMs, 500);
  assert.equal(withApi({ paths: ['/api'], backend: { run: 'x', readyUrl: 'http://localhost:1/', stop: 'docker compose down' } }).web.api.backend.stop, 'docker compose down');
  assert.equal(withApi({ paths: ['/api'], backend: { run: 'x', readyUrl: 'http://localhost:1/', seeded: true } }).web.api.backend.seeded, true);
});

test('web.api rejects each invalid shape with its message', () => {
  const bad = (api, message) => assert.throws(() => withApi(api), (error) => error.message.includes(`- ${message}`), JSON.stringify(api));
  for (const api of [null, 'x', [], { paths: ['/api'], extra: 1 }]) bad(api, apiMessages.shape);
  bad({}, apiMessages.needs);
  bad({ recordFrom: 'http://localhost:1' }, apiMessages.needs);
  for (const envVar of ['', '1X', 'A-B', 5, null]) bad({ envVar }, apiMessages.envVar);
  for (const paths of [[], '/api', ['api'], ['/api/'], ['/'], ['/a?b'], ['/a#b'], ['/a*'], ['/a b'], ['/api', '/api'], [1]]) bad({ paths }, apiMessages.paths);
  for (const recordFrom of ['nope', 'ftp://x', 5, 'http://u:p@host']) bad({ paths: ['/api'], recordFrom }, apiMessages.recordFrom);
  for (const headers of [[], null, 'x', { 'bad name': 'v' }, { a: 1 }, { a: '${' }, { a: '${1X}' }, { a: '${OK} ${' }]) bad({ paths: ['/api'], headers }, apiMessages.headers);
  for (const backend of [null, 'x', [], { readyUrl: 'http://x/' }, { run: ' ', readyUrl: 'http://x/' }, { run: 'x', readyUrl: 'nope' }, { run: 'x', readyUrl: 'http://x/', timeoutMs: 0 }, { run: 'x', readyUrl: 'http://x/', timeoutMs: 1.5 }, { run: 'x', readyUrl: 'http://x/', extra: 1 }, { run: 'x', readyUrl: 'http://x/', stop: ' ' }, { run: 'x', readyUrl: 'http://x/', stop: 5 }, { run: 'x', readyUrl: 'http://x/', seeded: 'yes' }]) {
    bad({ paths: ['/api'], backend }, apiMessages.backend);
  }
  withApi({ paths: ['/api'], headers: { 'X-Dev-Role': 'Admin', Authorization: 'Bearer ${API_TOKEN}' } });
});

test('session apiHeaders are accepted when valid and rejected otherwise', () => {
  const session = (apiHeaders) => ({ sessions: [{ name: 'member', localStorage: { a: 'b' }, apiHeaders }] });
  const accepted = withApi({ paths: ['/api'] }, session({ 'X-Dev-User': 'member', Authorization: '${TOKEN}' }));
  assert.deepEqual(accepted.web.sessions[1].apiHeaders, { 'X-Dev-User': 'member', Authorization: '${TOKEN}' });
  for (const apiHeaders of [[], null, 'x', { 'bad name': 'v' }, { a: 5 }, { a: '${' }]) {
    assert.throws(() => withApi({ paths: ['/api'] }, session(apiHeaders)), (error) => error.message.includes(`- ${apiMessages.apiHeaders}`));
  }
});

test('web.api.expectedStatuses normalizes statuses and rejects malformed entries', () => {
  const withExpected = (expectedStatuses) => normalizeConfig({ repo: '/repo', web: { build: { run: 'b' }, routes: ['/'], api: { paths: ['/api'], expectedStatuses } } }, { projectName: 'demo' });
  assert.deepEqual(withExpected([{ request: 'GET /api/(a|b)', status: 404 }, { request: 'POST /api/items', status: [409, 422] }]).web.api.expectedStatuses,
    [{ request: 'GET /api/(a|b)', status: [404] }, { request: 'POST /api/items', status: [409, 422] }]);
  assert.deepEqual(normalizeConfig({ repo: '/repo', web: { build: { run: 'b' }, routes: ['/'], api: { paths: ['/api'] } } }, { projectName: 'demo' }).web.api.expectedStatuses, []);
  for (const entry of [{ request: '/api/a', status: 404 }, { request: 'FETCH /api/a', status: 404 }, { request: 'GET /api/(', status: 404 },
    { request: 'GET /api/a', status: 200 }, { request: 'GET /api/a', status: [] }, { request: 'GET /api/a', status: '404' }, { request: 'GET /api/a', status: 404, note: 'x' }]) {
    assert.throws(() => withExpected([entry]), /web\.api\.expectedStatuses\[0\]` needs `request` as "METHOD \/path-regex"/, JSON.stringify(entry));
  }
  assert.throws(() => withExpected({ request: 'GET /api/a', status: 404 }), /must be a list of \{ request, status \} entries/);
});

test('web browsers and devices default and are validated', () => {
  const make = (web = {}) => normalizeConfig({ repo: '/tmp/app', web: { build: { run: 'true' }, routes: ['home'], ...web } }, { projectName: 'demo' });
  assert.deepEqual(make().web.browsers, ['chromium']);
  assert.deepEqual(make().web.devices, []);
  assert.deepEqual(make({ browsers: ['firefox'], devices: ['iPhone 13'] }).web.devices, ['iPhone 13']);
  assert.throws(() => make({ browsers: ['ie'] }), /- `web\.browsers` must list unique browsers from chromium, firefox and webkit/);
  assert.throws(() => make({ devices: ['iPhone 13', 'iphone 13'] }), /- `web\.devices` must list unique Playwright device names such as "iPhone 13"/);
});

const faults = (faultInjection) => normalizeConfig({ repo: '/tmp/app', web: { build: { run: 'true' }, routes: ['/'], faultInjection } }, { projectName: 'demo' });

test('fault kinds accept known values, stringify them and add no default', () => {
  assert.deepEqual(faults({ kinds: ['abort', 429] }).web.faultInjection.kinds, ['abort', '429']);
  assert.equal('kinds' in faults({ delayMs: 10 }).web.faultInjection, false);
  for (const kinds of [[], ['404'], ['500', '500'], '500', { 0: '500' }]) {
    assert.throws(() => faults({ kinds }), /`web.faultInjection.kinds` must list unique values from 500, delay, abort, 401, 403, 429, malformed/);
  }
});


test('fault optimization options validate route names, concurrency and observation budgets', () => {
  const options = { routes: ['/'], concurrency: 8, terminalSelector: '#failed', minObservationMs: 1000, timeoutMs: 2000 };
  assert.equal(faults(options).web.faultInjection.concurrency, 8);
  for (const bad of [{ routes: [] }, { routes: ['missing'] }, { routes: ['/', '/'] }, { concurrency: 0 }, { concurrency: 1.5 }, { terminalSelector: '' }, { terminalSelector: '#failed' }, { minObservationMs: 0 }, { ...options, minObservationMs: -1 }, { ...options, minObservationMs: 2000 }]) {
    assert.throws(() => faults(bad), /Invalid projects/);
  }
});

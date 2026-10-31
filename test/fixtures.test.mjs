import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiRequestMatcher, fixturesAreCurrent, matchesApiPath, recordingHeaders, requestKey } from '../src/fixtures.mjs';

test('matchesApiPath matches whole path segments only', () => {
  assert(matchesApiPath('/api', ['/api']));
  assert(matchesApiPath('/api/x', ['/api']));
  assert(!matchesApiPath('/apix', ['/api']));
  assert(!matchesApiPath('/', ['/api']));
  assert(!matchesApiPath('/api', []));
  assert(matchesApiPath('/admin/v1/users', ['/api', '/admin/v1']));
});

test('apiRequestMatcher selects the fake origin and app-origin paths under the prefixes', () => {
  const matches = apiRequestMatcher({ fakeOrigin: 'http://api.spotter.test', apiPaths: ['/api'], appOrigin: 'http://127.0.0.1:4000' });
  assert(matches(new URL('http://api.spotter.test/anything')));
  assert(matches(new URL('http://127.0.0.1:4000/api/items?a=1')));
  assert(!matches(new URL('http://127.0.0.1:4000/apix')));
  assert(!matches(new URL('http://127.0.0.1:4000/')));
  assert(!matches(new URL('https://cdn.example.com/api/items')));
  assert(!matches(new URL('http://127.0.0.1:4001/api/items')));
  const fakeOnly = apiRequestMatcher({ fakeOrigin: 'http://api.spotter.test', appOrigin: 'http://127.0.0.1:4000' });
  assert(fakeOnly(new URL('http://api.spotter.test/x')) && !fakeOnly(new URL('http://127.0.0.1:4000/api')));
});

test('requestKey of a same-origin URL does not depend on the port', () => {
  assert.equal(requestKey('get', 'http://127.0.0.1:4000/api/items?b=2&a=1'), 'GET /api/items?a=1&b=2');
  assert.equal(requestKey('GET', 'http://127.0.0.1:4000/api/items?a=1'), requestKey('GET', 'http://127.0.0.1:5123/api/items?a=1'));
});

test('recordingHeaders merges, lowercases and resolves environment references', () => {
  const api = { headers: { 'X-Dev-Role': 'Admin', Authorization: 'Bearer ${API_TOKEN}' } };
  const session = { apiHeaders: { 'x-dev-role': 'Member', 'X-Static': 'plain' } };
  const result = recordingHeaders(api, session, { API_TOKEN: 's3cret' });
  assert.deepEqual(result.headers, { 'x-dev-role': 'Member', authorization: 'Bearer s3cret', 'x-static': 'plain' });
  assert.deepEqual(result.secrets, ['Bearer s3cret']);
  assert.deepEqual(recordingHeaders({ headers: {} }, {}, {}), { headers: {}, secrets: [] });
  assert.deepEqual(recordingHeaders({}, {}, {}), { headers: {}, secrets: [] });
});

test('recordingHeaders fails when a referenced variable is missing or empty', () => {
  const api = { headers: { Authorization: 'Bearer ${API_TOKEN}' } };
  for (const env of [{}, { API_TOKEN: '' }]) {
    assert.throws(() => recordingHeaders(api, {}, env), { message: 'Recording header authorization needs environment variable API_TOKEN' });
  }
});

test('expected statuses match method, whole path and listed status only', async () => {
  const { isExpectedStatus } = await import('../src/fixtures.mjs');
  const expected = [{ request: 'GET /admin/(library|settings)', status: [404] }, { request: 'POST /api/items', status: [409, 422] }];
  assert.equal(isExpectedStatus(expected, 'GET', '/admin/library', 404), true);
  assert.equal(isExpectedStatus(expected, 'GET', '/admin/library', 500), false, 'fault or unlisted status');
  assert.equal(isExpectedStatus(expected, 'GET', '/admin/library', 409), false, 'other status on the same path');
  assert.equal(isExpectedStatus(expected, 'POST', '/admin/library', 404), false, 'other method');
  assert.equal(isExpectedStatus(expected, 'GET', '/admin/library-old', 404), false, 'pattern covers the whole path');
  assert.equal(isExpectedStatus(expected, 'POST', '/api/items', 422), true);
  assert.equal(isExpectedStatus(undefined, 'GET', '/admin/library', 404), false);
});

const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', encoding: 'utf8', body: JSON.stringify(body) });

test('fixture data summary counts populated, empty and 4xx responses and the seed step', async () => {
  const { summarizeFixtureData } = await import('../src/fixtures.mjs');
  const empty = { entries: { 'GET /a': json([]), 'GET /b': json({}), 'GET /c': json({ title: 'Not Found' }, 404) }, sessions: { member: { 'GET /a': json([]) } } };
  assert.deepEqual(summarizeFixtureData(empty), { data: 0, empty: 3, clientErrors: 1, seeded: null });
  const mixed = { entries: { ...empty.entries, 'GET /d': json([{ id: 1 }]), 'GET /logo': { status: 200, contentType: 'image/png', encoding: 'base64', body: 'AAAA' }, 'GET /e': json({ error: 'x' }, 500) } };
  assert.deepEqual(summarizeFixtureData(mixed), { data: 1, empty: 2, clientErrors: 1, seeded: null });
  assert.deepEqual(summarizeFixtureData({ entries: { 'GET /d': json({ items: [] }) } }), { data: 1, empty: 0, clientErrors: 0, seeded: null });
  assert.equal(summarizeFixtureData(empty, { run: 'node server.mjs' }).seeded, false);
  assert.equal(summarizeFixtureData(empty, { run: 'node server.mjs', seeded: true }).seeded, true);
  assert.equal(summarizeFixtureData(empty, { run: '(cd api && npm ci && npm run db:seed) && exec npm run start' }).seeded, true);
  assert.equal(summarizeFixtureData(empty, { run: 'npm run seed-check && npm run start' }).seeded, false);
});

test('old fixture files without a data summary still load', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { loadFixtures } = await import('../src/fixtures.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'spotter-fixtures-'));
  try {
    await writeFile(path.join(dir, 'api.json'), JSON.stringify({ recordedAt: '2026-01-01T00:00:00Z', source: 'http://x', entries: { 'GET /a': json([]) } }));
    const loaded = await loadFixtures(dir);
    assert.equal(loaded.summary, undefined);
    assert.equal(loaded.entries['GET /a'].status, 200);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fixtures are current only for the exact committed tree', () => {
  assert.equal(fixturesAreCurrent({ sha: 'abc' }, 'abc'), true);
  assert.equal(fixturesAreCurrent({ sha: 'abc' }, 'def'), false);
  assert.equal(fixturesAreCurrent({ sha: 'abc' }, 'abc', true), false);
});

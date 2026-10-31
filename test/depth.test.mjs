import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.mjs';
import { replayFixtures } from '../src/fixtures.mjs';

const config = (web) => normalizeConfig({ repo: '/tmp/app', web: { build: { run: 'true' }, routes: ['/'], ...web } }, { projectName: 'demo' });
test('sessions are isolated and invalid session/fault settings are rejected', () => {
  const web = config({ sessions: [{ name: 'member', localStorage: { token: 'test' } }] }).web;
  assert.deepEqual(web.sessions.map((s) => s.name), ['anonymous', 'member']);
  for (const sessions of [[{ name: 'constructor', localStorage: {} }], [null], [{ name: 'bad', localStorage: [] }], [{ name: 'anonymous', localStorage: {} }], [{ name: '../bad', localStorage: {} }], [{ name: 'member', localStorage: { token: 1 } }], [{ name: 'member', localStorage: {} }, { name: 'member', localStorage: {} }]]) {
    assert.throws(() => config({ sessions }), /sessions/);
  }
  assert.throws(() => config({ faultInjection: { timeoutMs: -1 } }), /timeoutMs/);
  assert.throws(() => config({ faultInjection: { loadingSelector: 123 } }), /loadingSelector/);
  assert.equal(config({ faultInjection: false }).web.faultInjection, null);
});

test('fault replay changes only the selected recorded endpoint and preserves missing requests', async () => {
  let handler;
  const context = { route: async (_, fn) => { handler = fn; } };
  const missing = [];
  const observed = [];
  await replayFixtures(context, {
    fakeOrigin: 'http://api.test', appOrigin: 'http://app.test',
    fixtures: { entries: { 'GET /one': { status: 200, body: 'one' }, 'GET /two': { status: 200, body: 'two' } } },
    fault: { key: 'GET /one', kind: '500' },
    onRequest: (key) => observed.push(key), onUnrecorded: (key) => missing.push(key),
  });
  const replay = async (path, method = 'GET') => {
    let result;
    await handler({ request: () => ({ method: () => method, url: () => `http://api.test${path}`, headers: () => ({}) }), fulfill: async (response) => { result = response; } });
    return result;
  };
  assert.equal((await replay('/one')).status, 500);
  assert.equal((await replay('/two')).body, 'two');
  assert.equal((await replay('/missing')).headers['x-spotter-unrecorded'], '1');
  assert.equal((await replay('/one', 'OPTIONS')).status, 204);
  assert.deepEqual(observed, ['GET /one', 'GET /two']);
  assert.deepEqual(missing, ['GET /missing']);
});

test('fixture refresh records a missing GET but never sends a missing write', async () => {
  let handler;
  const context = { route: async (_, fn) => { handler = fn; } };
  const entries = {};
  const missing = [];
  await replayFixtures(context, {
    fakeOrigin: 'http://api.test', appOrigin: 'http://app.test', fixtures: { entries }, onUnrecorded: (key) => missing.push(key),
    recordMissing: { liveOrigin: 'http://live.test', entries },
  });
  const request = (method) => ({
    request: () => ({ method: () => method, url: () => 'http://api.test/new', headers: () => ({}) }),
    fetch: async ({ url }) => ({ status: () => 200, headers: () => ({ 'content-type': 'application/json' }), body: async () => Buffer.from(JSON.stringify({ url })) }),
    fulfill: async (response) => response,
  });
  assert.equal((await handler(request('GET'))).status, 200);
  assert.equal(JSON.parse(entries['GET /new'].body).url, 'http://live.test/new');
  assert.equal((await handler(request('POST'))).status, 404);
  assert.deepEqual(missing, ['POST /new']);
});

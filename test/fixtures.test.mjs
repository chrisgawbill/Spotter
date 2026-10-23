import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiRequestMatcher, matchesApiPath, recordingHeaders, requestKey } from '../src/fixtures.mjs';

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

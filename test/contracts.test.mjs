import test from 'node:test';
import assert from 'node:assert/strict';
import { compareContracts, snapshotContracts } from '../src/contracts.mjs';

const response = (value, status = 200) => ({ status, contentType: 'application/json', encoding: 'utf8', body: JSON.stringify(value) });
const fixtures = (entries, sessions = {}) => ({ entries, sessions });

test('contracts ignore JSON values, property order and array order/count', () => {
  const old = fixtures({ 'GET /teams': response([{ id: 1, name: 'A' }, null]) });
  const next = fixtures({ 'GET /teams': response([null, { name: 'B', id: 2 }, { id: 3, name: 'C' }]) });
  assert.deepEqual(compareContracts(old, next), []);
  assert.deepEqual(compareContracts(null, next), []);
});

test('contracts detect nested fields, types, nullability, status and endpoint changes by session', () => {
  const old = fixtures({ 'GET /teams': response({ team: { id: 1, name: 'A' } }), 'GET /gone': response([]) },
    { member: { 'GET /teams': response({ private: true }) } });
  const next = fixtures({ 'GET /teams': response({ team: { id: '1', active: true } }), 'GET /new': response([]) },
    { member: { 'GET /teams': response({ private: null }, 403) } });
  const changes = compareContracts(old, next);
  assert.deepEqual(changes.map(({ session, request, kind }) => ({ session, request, kind })), [
    { session: 'anonymous', request: 'GET /gone', kind: 'removed' },
    { session: 'anonymous', request: 'GET /new', kind: 'added' },
    { session: 'anonymous', request: 'GET /teams', kind: 'changed' },
    { session: 'member', request: 'GET /teams', kind: 'changed' },
  ]);
  assert.deepEqual(changes[2].after.shape, { object: { team: { object: { active: 'boolean', id: 'string' } } } });
  assert.equal(changes[3].after.status, 403);
  assert.deepEqual(changes[3].after.shape, { object: { private: 'null' } });
});

test('empty arrays stay observable and non-JSON bodies compare media type instead of content', () => {
  const old = fixtures({ 'GET /items': response([]), 'GET /text': { status: 200, contentType: 'text/plain; charset=utf-8', body: 'old' } });
  const next = fixtures({ 'GET /items': response([1]), 'GET /text': { status: 200, contentType: 'text/plain', body: 'new' } });
  assert.deepEqual(compareContracts(old, next).map((change) => change.request), ['GET /items']);
  const binaryJson = fixtures({ 'GET /items': { ...response([1]), encoding: 'base64', body: Buffer.from('[2]').toString('base64') } });
  assert.deepEqual(snapshotContracts(binaryJson).anonymous['GET /items'].shape, { array: ['number'] });
  const changedMediaType = fixtures({ 'GET /items': { ...response([]), contentType: 'application/problem+json' }, 'GET /text': old.entries['GET /text'] });
  assert.equal(compareContracts(old, changedMediaType)[0].after.contentType, 'application/problem+json');
});

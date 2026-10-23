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

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

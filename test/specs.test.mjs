import assert from 'node:assert/strict';
import { test } from 'node:test';
import { specFindings } from '../src/stages/specs.mjs';

test('spec identities distinguish Verify names and remain stable when locations change', () => {
  const report = (line) => ({ suites: [{ title: 'verify.spec.mjs', specs: [1, 2].map((number) => ({
    title: `TICKET Verify ${number}`, file: '/project/verify.spec.mjs', line,
    tests: [{ status: 'unexpected', projectName: 'chromium', results: [{ errors: [{ message: 'assertion failed' }] }] }],
  })) }] });
  const before = specFindings(report(4), '/project');
  const after = specFindings(report(40), '/project');
  assert.deepEqual(before.map((f) => f.id), after.map((f) => f.id));
  assert.notEqual(before[0].id, before[1].id);
  assert.equal(before[0].file, 'verify.spec.mjs');
});

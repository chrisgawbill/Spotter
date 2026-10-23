import assert from 'node:assert/strict';
import { test } from 'node:test';
import { specFindings, specSummary } from '../src/stages/specs.mjs';

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

test('spec summary counts selected tests and flags runner failure or a missing report', () => {
  const report = { stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 3 } };
  assert.deepEqual(specSummary(report, false, 1, false), { mode: 'replay', passed: 2, failed: 1, skipped: 3, flaky: 1, selected: 7, completed: true });
  assert.equal(specSummary(report, true, 1, true).completed, false);
  assert.equal(specSummary(report, true, 1, true).mode, 'live');
  assert.deepEqual(specSummary(null, true, 1, false), { mode: 'replay', passed: 0, failed: 1, skipped: 0, flaky: 0, selected: 0, completed: false });
});

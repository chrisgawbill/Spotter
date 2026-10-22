import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareWithBaseline, createFinding, hasFailingFinding } from '../src/findings.mjs';

const finding = (overrides) => createFinding({ stage: 'static', check: 'typecheck', severity: 'high', title: 'TS2322: x', ...overrides });

test('fingerprints ignore line numbers and digits but keep the file and key', () => {
  assert.equal(finding({ line: 3 }).id, finding({ line: 40 }).id);
  assert.equal(finding({ title: 'overflow by 12px' }).id, finding({ title: 'overflow by 64px' }).id);
  assert.notEqual(finding({ file: 'a.ts' }).id, finding({ file: 'b.ts' }).id);
  assert.notEqual(finding({ key: { viewport: 375 } }).id, finding({ key: { viewport: 1280 } }).id);
});

test('splits head findings into new, existing and fixed', () => {
  const shared = finding({ file: 'shared.ts' });
  const onlyHead = finding({ file: 'head.ts' });
  const onlyBase = finding({ file: 'base.ts' });
  const { newFindings, existingFindings, fixedFindings } = compareWithBaseline([shared, onlyHead], [shared, onlyBase]);
  assert.deepEqual(newFindings.map((item) => item.file), ['head.ts']);
  assert.deepEqual(existingFindings.map((item) => item.file), ['shared.ts']);
  assert.deepEqual(fixedFindings.map((item) => item.file), ['base.ts']);
});

test('only high and medium findings fail a run', () => {
  assert.equal(hasFailingFinding([finding({ severity: 'low' })]), false);
  assert.equal(hasFailingFinding([finding({ severity: 'medium' })]), true);
});

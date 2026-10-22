import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parsePrettierOutput } from '../src/parsers/prettier.mjs';
import { parseTscOutput } from '../src/parsers/tsc.mjs';
import { parseVitestReport } from '../src/parsers/vitest.mjs';
import { parseGenericOutput } from '../src/parsers/generic.mjs';

test('tsc: one finding per error with continuation lines as detail', () => {
  const output = [
    "src/a.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    "  Type 'x' is missing.",
    'src/b.ts(1,1): error TS2307: Cannot find module \'@/nope\'.',
  ].join('\n');
  const findings = parseTscOutput({ output });
  assert.equal(findings.length, 2);
  assert.deepEqual([findings[0].file, findings[0].line], ['src/a.tsx', 12]);
  assert.match(findings[0].title, /^TS2322/);
  assert.equal(findings[0].detail, "Type 'x' is missing.");
});

test('prettier: lists unformatted files, not the summary line', () => {
  const output = 'Checking formatting...\n[warn] src/a.ts\n[warn] src/b.css\n[warn] Code style issues found in 2 files.';
  assert.deepEqual(parsePrettierOutput({ output }).map((item) => item.file), ['src/a.ts', 'src/b.css']);
});

test('vitest: failed tests and suites that failed to load', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'spotter-'));
  const reportFile = path.join(directory, 'report.json');
  writeFileSync(
    reportFile,
    JSON.stringify({
      testResults: [
        { name: `${directory}/src/a.test.ts`, status: 'failed', assertionResults: [{ fullName: 'adds', status: 'failed', failureMessages: ['expected 1 to be 2'] }, { fullName: 'ok', status: 'passed' }] },
        { name: `${directory}/src/b.test.ts`, status: 'failed', message: 'SyntaxError: boom', assertionResults: [] },
        { name: `${directory}/src/c.test.ts`, status: 'passed', assertionResults: [{ status: 'passed' }] },
      ],
    }),
  );
  const findings = parseVitestReport({ reportFile, cwd: directory });
  assert.deepEqual(findings.map((item) => [item.file, item.title]), [
    ['src/a.test.ts', 'test failed: adds'],
    ['src/b.test.ts', 'test file failed to run'],
  ]);
});

test('generic: nothing on success, log tail on failure', () => {
  assert.deepEqual(parseGenericOutput({ exitCode: 0, output: 'fine' }), []);
  const [failure] = parseGenericOutput({ exitCode: 2, output: 'a\n\nb\nboom' });
  assert.equal(failure.title, 'exited with code 2');
  assert.equal(failure.detail, 'a\nb\nboom');
});

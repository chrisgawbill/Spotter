import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.mjs';
import { parseAddedLines } from '../src/git.mjs';
import { globToRegExp } from '../src/glob.mjs';
import { findImportSpecifiers, resolveSpecifier, runRulesStage } from '../src/stages/rules.mjs';

function writeTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'spotter-rules-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const baseConfig = (rules) => normalizeConfig({ repo: '/repo', workdir: 'react', rules }, { projectName: 'demo' });
const noChanges = { addedLines: [], commits: [] };

test('globs: **, * and braces', () => {
  assert.ok(globToRegExp('src/**/*.{ts,tsx}').test('src/a/b/c.tsx'));
  assert.ok(globToRegExp('src/**/*.{ts,tsx}').test('src/c.ts'));
  assert.ok(!globToRegExp('src/**/*.{ts,tsx}').test('src/c.css'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
});

test('import specifiers and resolution', () => {
  assert.deepEqual(findImportSpecifiers(`import { a } from '@/features/x/y'; import('./z')`), ['@/features/x/y', './z']);
  assert.equal(resolveSpecifier('@/features/x/y', 'src/features/a/b.ts', { '@/': 'src/' }), 'src/features/x/y');
  assert.equal(resolveSpecifier('../../x/y', 'src/features/a/b/c.ts', {}), 'src/features/x/y');
  assert.equal(resolveSpecifier('react', 'src/a.ts', {}), null);
});

test('import boundaries flag cross-slice imports unless allowed', async () => {
  const workdir = writeTree({
    'src/features/teams/A.tsx': "import { x } from '@/features/schedule/utils/gameStatusHelper';\nimport { y } from '@/features/standings/types/s';",
    'src/features/matchup/B.tsx': "import { z } from '../teams/C';\nimport { w } from './local';",
  });
  const config = baseConfig({
    importBoundaries: [{ id: 'bounds', root: 'src/features', aliases: { '@/': 'src/' }, allow: [{ from: '*', to: 'schedule/utils/gameStatusHelper' }] }],
  });
  const { findings } = await runRulesStage({ config, workdir, changes: noChanges });
  assert.deepEqual(findings.map((item) => [item.file, item.line, item.title]), [
    ['react/src/features/matchup/B.tsx', 1, 'cross-slice import: matchup → teams'],
    ['react/src/features/teams/A.tsx', 2, 'cross-slice import: teams → standings'],
  ]);
});

test('forbidden text in commits, added lines (glob relative to workdir) and files', async () => {
  const workdir = writeTree({ 'src/a.ts': "import x from '../../x';\nconst ok = 1;" });
  const config = baseConfig({
    forbiddenText: [
      { id: 'ai', pattern: '\\bclaude\\b', in: ['commits', 'added-lines'], glob: 'src/**', message: 'mentions AI' },
      { id: 'climb', pattern: "from\\s+'\\.\\./\\.\\./", in: 'files', glob: 'src/**/*.ts', message: 'climbs' },
    ],
  });
  const changes = {
    commits: [{ sha: 'abcdef1234567', message: 'Fix\n\nCo-Authored-By: Claude' }],
    addedLines: [
      { file: 'react/src/b.ts', line: 4, text: '// written by Claude' },
      { file: 'docs/notes.md', line: 1, text: 'Claude' },
    ],
  };
  const { findings } = await runRulesStage({ config, workdir, changes });
  assert.deepEqual(findings.map((item) => [item.check, item.file, item.line]), [
    ['ai', null, null],
    ['ai', 'react/src/b.ts', 4],
    ['climb', 'react/src/a.ts', 1],
  ]);
});

test('parses added lines from a zero-context diff', () => {
  const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,0 +2,2 @@\n+one\n+two\n@@ -9 +11 @@\n-old\n+new';
  assert.deepEqual(parseAddedLines(diff), [
    { file: 'x', line: 2, text: 'one' },
    { file: 'x', line: 3, text: 'two' },
    { file: 'x', line: 11, text: 'new' },
  ]);
});

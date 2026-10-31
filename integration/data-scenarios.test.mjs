// Run in the Spotter image: node --test integration/data-scenarios.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSpecsStage } from '../src/stages/specs.mjs';
import { startStaticServer } from '../src/staticServer.mjs';
import { compareWithBaseline } from '../src/findings.mjs';

const SEEDS = [
  { name: 'empty-list crash', test: 'empty results', from: 'status.textContent = items.length ?', to: 'status.textContent = items[0].name && items.length ?' },
  { name: 'long-text overflow', test: 'long text', from: 'overflow-wrap: anywhere;', to: 'white-space: nowrap;' },
  { name: 'missing-field crash', test: 'missing optional fields', from: "item.note ?? '—'", to: 'item.note === undefined ? item.note.toUpperCase() : item.note' },
];

test('project-owned data scenarios are deterministic, selectable and baseline-aware', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-data-'));
  let server;
  try {
    await cp(new URL('../examples/data-scenarios', import.meta.url), root, { recursive: true });
    await mkdir(path.join(root, 'logs'));
    server = await startStaticServer(root, '/');
    const config = { web: { base: '/', settleMs: 0, specs: { files: ['results.journey.mjs'], workers: 2 }, sessions: [{ name: 'anonymous', localStorage: {} }] } };
    const fixtures = { recordedAt: '2026-01-01T12:00:00.000Z', entries: { 'GET /api/results': { status: 200, body: '{"items":[{"name":"recorded"}]}' } } };
    const original = structuredClone(fixtures);
    const run = (name) => runSpecsStage({ config, workdir: root, logDir: path.join(root, 'logs', name), fixtures, appOrigin: server.origin });

    let healthy;
    await t.test('all documented variants pass and artifacts name their scenario', async () => {
      healthy = await run('healthy');
      assert.equal(healthy.summary.passed, 7, JSON.stringify(healthy));
      assert.deepEqual(healthy.findings, []);
      assert.deepEqual(fixtures, original, 'route overrides must not mutate the recording');
      const report = JSON.parse(await readFile(path.join(root, 'logs/healthy/specs/results.json'), 'utf8'));
      const names = report.suites.flatMap((suite) => suite.specs).flatMap((spec) => spec.tests).flatMap((entry) => entry.results).flatMap((result) => result.attachments.map((attachment) => attachment.name));
      assert.deepEqual(names.sort(), ['data-scenario-empty', 'data-scenario-large', 'data-scenario-long', 'data-scenario-missing', 'data-scenario-unexpected', 'data-scenario-unicode', 'data-scenario-zero']);
    });

    await t.test('empty, long and missing-field defects are new stable scenario findings', async () => {
      const file = path.join(root, 'index.html');
      const html = await readFile(file, 'utf8');
      const ids = new Set();
      for (const seed of SEEDS) {
        assert.equal(html.split(seed.from).length - 1, 1, seed.name);
        try {
          await writeFile(file, html.replace(seed.from, seed.to));
          const seeded = await run(seed.name);
          const fresh = compareWithBaseline(seeded.findings, healthy.findings).newFindings;
          assert.equal(fresh.length, 1, `${seed.name}: ${JSON.stringify(fresh)}`);
          assert.match(fresh[0].title, new RegExp(seed.test));
          assert.match(fresh[0].id, /^[0-9a-f]{12}$/);
          ids.add(fresh[0].id);
        } finally {
          await writeFile(file, html);
        }
      }
      assert.equal(ids.size, SEEDS.length, 'each named scenario has its own fingerprint');
      assert.deepEqual(fixtures, original);
    });

    await t.test('low-level grep selects the bounded critical set', async () => {
      config.web.specs.grep = '@critical';
      const low = await run('low');
      assert.equal(low.summary.selected, 3, JSON.stringify(low));
      assert.equal(low.summary.passed, 3);
    });
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

// Run in the Spotter image: node --test integration/recovery.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSpecsStage } from '../src/stages/specs.mjs';
import { startStaticServer } from '../src/staticServer.mjs';
import { compareWithBaseline } from '../src/findings.mjs';

const names = {
  malformed: 'Recovery Verify: a malformed response shows an error and Retry recovers @critical',
  stale: 'Recovery Verify: a stale response never overwrites a newer one @critical',
};

// Each seed replaces `from` (present exactly once in index.html) with `to`.
const SEEDS = [
  { name: 'permanently disabled control', test: names.malformed, from: 'refresh.disabled = false;', to: 'if (names) refresh.disabled = false;' }, // Refresh re-enabled only after a successful load
  { name: 'ineffective retry', test: names.malformed, from: "button('Retry', load)", to: "button('Retry', () => { error.hidden = true; })" }, // Retry hides the alert but does not reload
  { name: 'stale overwrite', test: names.stale, from: 'if (request !== latest) return;', to: '' }, // latest-request guard removed
];

test('recovery', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-recovery-'));
  let server;
  try {
    await cp(new URL('../examples/recovery', import.meta.url), root, { recursive: true });
    await mkdir(path.join(root, 'logs'));
    server = await startStaticServer(root, '/');
    const config = { web: { base: '/', specs: { files: ['scores.journey.mjs'], workers: 2 }, sessions: [{ name: 'anonymous', localStorage: {} }] } };
    // A recorded time freezes Date as in real runs; the Retry-After timer must still fire.
    const run = (name) => runSpecsStage({ config, workdir: root, logDir: path.join(root, 'logs', name), fixtures: { recordedAt: '2026-01-01T12:00:00.000Z', entries: {} }, appOrigin: server.origin });

    let healthy;
    await t.test('healthy recovery scenarios pass in parallel without injected-error noise', async () => {
      healthy = await run('healthy');
      assert.equal(healthy.summary.passed, 7, JSON.stringify(healthy));
      assert.deepEqual(healthy.findings, []);
      assert.equal(healthy.summary.completed, true);
    });

    await t.test('each seeded defect fails its named scenario and is new against the healthy baseline', async () => {
      const htmlFile = path.join(root, 'index.html');
      const html = await readFile(htmlFile, 'utf8');
      for (const seed of SEEDS) {
        assert.equal(html.split(seed.from).length - 1, 1, `${seed.name}: from must occur exactly once`);
        await writeFile(htmlFile, html.replace(seed.from, () => seed.to));
        const seeded = await run(seed.name.replaceAll(' ', '-'));
        const { newFindings } = compareWithBaseline(seeded.findings, healthy.findings);
        console.log(`${seed.name}: ${newFindings.map((finding) => finding.title).join(' | ')}`);
        assert.ok(newFindings.some((finding) => finding.title.includes(seed.test)), `${seed.name}: ${JSON.stringify(seeded.findings.map((f) => f.title))}`);
        assert.ok(newFindings.every((finding) => finding.check === 'project-spec'));
        await writeFile(htmlFile, html);
      }
    });

    await t.test('the @critical grep selects only critical scenarios', async () => {
      config.web.specs.grep = '@critical';
      const critical = await run('critical');
      assert.equal(critical.summary.selected, 3, JSON.stringify(critical));
      assert.equal(critical.summary.passed, 3);
    });
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

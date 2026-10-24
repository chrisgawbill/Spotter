// Run in the Spotter image: node --test integration/journeys.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSpecsStage } from '../src/stages/specs.mjs';
import { startStaticServer } from '../src/staticServer.mjs';
import { compareWithBaseline } from '../src/findings.mjs';

const names = {
  save: 'Journey Verify: invalid name is rejected, then the corrected name saves @critical',
  double: 'Journey Verify: a double-clicked Save sends one write @critical',
  state: 'Journey Verify: filter and page survive reload and back/forward',
  focus: 'Journey Verify: the delete dialog works by keyboard and restores focus',
  admin: 'Journey Verify: the admin route requires the admin role @critical',
};

// Each seed replaces `from` (present exactly once in index.html) with `to`.
const SEEDS = [
  { name: 'broken save', test: names.save, from: 'body: JSON.stringify({ name })', to: 'body: JSON.stringify({ name: item.name })' }, // PUT body ignores the edited value
  { name: 'duplicate write', test: names.double, from: 'save.disabled = true;', to: '' }, // Save not disabled while pending
  { name: 'lost state', test: names.state, from: "history.pushState(null, '', '#/items' + (qs && '?' + qs));", to: "history.pushState(null, '', '#/items');" }, // filter/page not written to the URL
  { name: 'focus restoration', test: names.focus, from: '    opener.focus();\n', to: '' }, // close does not refocus the opener
  { name: 'unauthorized route', test: names.admin, from: "localStorage.getItem('role') === 'admin'", to: 'true' }, // role check removed
];

test('journeys', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-journeys-'));
  let server;
  try {
    await cp(new URL('../examples/journeys', import.meta.url), root, { recursive: true });
    await mkdir(path.join(root, 'logs'));
    server = await startStaticServer(root, '/');
    const config = { web: { base: '/', specs: { files: ['items.journey.mjs'], workers: 2 }, sessions: [{ name: 'anonymous', localStorage: {} }, { name: 'admin', localStorage: { role: 'admin' } }] } };
    const run = (name) => runSpecsStage({ config, workdir: root, logDir: path.join(root, 'logs', name), fixtures: null, appOrigin: server.origin });

    let healthy;
    await t.test('healthy journeys pass in parallel with isolated state', async () => {
      healthy = await run('healthy');
      assert.equal(healthy.summary.passed, 7, JSON.stringify(healthy));
      assert.deepEqual(healthy.findings, []);
      assert.equal(healthy.summary.completed, true);
    });

    await t.test('each seeded defect fails its named journey and is new against the healthy baseline', async () => {
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

    await t.test('the @critical grep selects only critical journeys', async () => {
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

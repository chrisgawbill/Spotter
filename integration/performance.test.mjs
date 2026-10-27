// Run in the Spotter image: node --test integration/performance.test.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config.mjs';
import { compareWithBaseline } from '../src/findings.mjs';
import { createTimingGate, relativeBudgetFindings } from '../src/performance.mjs';
import { runWebStage } from '../src/stages/web.mjs';

const fixtures = { recordedAt: '2026-01-01T12:00:00.000Z', entries: { 'GET /api/items': { status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ name: 'Alpha' }, { name: 'Bravo' }] }) } } };
const performance = {
  budgets: [
    { metric: 'build.js', maxIncrease: '10%' },
    { metric: 'route.*.requests', maxIncrease: 0, blocking: true },
    { metric: 'route.*.apiRequests', max: 1 },
    { metric: 'interaction.open details', maxIncrease: '100%' },
    { metric: 'timing.home.load', maxIncrease: '100%' },
  ],
  timings: { samples: 5, routes: ['home'], interactions: { grep: '@perf' } },
};
const webConfig = (dir, withPerformance = true) => normalizeConfig({
  repo: dir,
  web: {
    build: { run: 'mkdir -p dist && cp index.html app.js dist/', outDir: 'dist' }, api: { paths: ['/api'] },
    routes: [{ name: 'home', path: '/' }], viewports: [1280], accessibility: false, keyboard: false, faultInjection: false,
    specs: { files: ['details.journey.mjs'] }, ...(withPerformance ? { performance } : {}),
  },
}, { projectName: 'performance-example' });

const BUSY = 'for (const end = performance.now() + 400; performance.now() < end;);'; // performance.now: Date is frozen in specs
// Each seed replaces `from` (present exactly once in app.js) with `to`; `expected` are the metrics new against the healthy run.
const SEEDS = [
  { name: 'bundle growth', from: '/* bundle seed */', to: `globalThis.seed = '${randomBytes(150000).toString('base64')}';`, expected: ['build.js'] },
  { name: 'request multiplication', from: 'load();', to: 'load(); load(); load(); load(); load();', expected: ['route.home.apiRequests', 'route.home.requests'] },
  { name: 'slow interaction', from: 'details.hidden = false;', to: `${BUSY} details.hidden = false;`, expected: ['interaction.open details'] },
];

const metricOf = (finding) => finding.title.match(/(?:exceeded|regression): (.+?) (?:is|rose) /)[1];

test('performance budgets', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-performance-'));
  let count = 0;
  // One side: a fresh copy of the example (optionally with `app.js` rewritten), built and measured by the web stage.
  const side = async ({ seed, config = webConfig, timingGate } = {}) => {
    const dir = path.join(root, `side-${count++}`);
    await cp(new URL('../examples/performance', import.meta.url), dir, { recursive: true });
    await mkdir(path.join(dir, 'logs'));
    if (seed) {
      const appFile = path.join(dir, 'app.js');
      const source = await readFile(appFile, 'utf8');
      assert.equal(source.split(seed.from).length - 1, 1, `${seed.name}: from must occur exactly once`);
      await writeFile(appFile, source.replace(seed.from, () => seed.to));
    }
    const cfg = config(dir);
    const result = await runWebStage({ config: cfg, workdir: dir, logDir: path.join(dir, 'logs'), screenshotDir: path.join(dir, 'screenshots'), fixtures, timingGate });
    return { cfg, ...result, perf: result.summary.performance };
  };
  // Head findings (stage absolute ones plus relative ones against `base`) split from the base's absolute ones.
  const compare = (head, base) => {
    const relative = relativeBudgetFindings(head.cfg.web.performance, head.perf, base.perf, { baseCached: false, project: 'performance-example' });
    const all = [...head.findings, ...relative.findings];
    return { relative, all, newFindings: compareWithBaseline(all, base.findings).newFindings.filter((finding) => finding.check === 'performance-budget') };
  };
  const show = (label, run) => console.log(`${label}: resources ${JSON.stringify(run.perf.resources)}; ${Object.entries(run.perf.timings ?? {}).map(([metric, v]) => `${metric} median ${v.median} min ${v.min} max ${v.max}`).join('; ')}`);

  try {
    let healthy;
    await t.test('healthy repeat is reproducible', async () => {
      healthy = await side();
      const repeat = await side();
      show('healthy 1', healthy);
      show('healthy 2', repeat);
      assert.deepEqual(repeat.perf.resources, healthy.perf.resources);
      for (const run of [healthy, repeat]) {
        assert.equal(run.perf.timingError, null);
        assert.deepEqual(Object.keys(run.perf.timings).sort(), ['interaction.open details', 'timing.home.load']);
        for (const timing of Object.values(run.perf.timings)) assert.equal(timing.samples.length, 5);
        assert.equal(run.perf.environment.api, 'replayed');
        assert.deepEqual(run.findings.filter((finding) => finding.check === 'performance-budget'), []);
      }
      assert.deepEqual(compare(repeat, healthy).newFindings, []);
      assert.deepEqual(compare(healthy, repeat).newFindings, []);
      assert.deepEqual(compare(repeat, healthy).relative.notCompared, []);
    });

    await t.test('each seeded regression is new against the healthy run, and only for its metrics', async () => {
      for (const seed of SEEDS) {
        const seeded = await side({ seed });
        show(seed.name, seeded);
        const { newFindings } = compare(seeded, healthy);
        console.log(`${seed.name}: ${newFindings.map((finding) => `[${finding.severity}] ${finding.title}`).join(' | ')}`);
        assert.deepEqual(newFindings.map(metricOf).sort(), seed.expected, JSON.stringify(newFindings.map((finding) => finding.title)));
        if (seed.name === 'request multiplication') assert.equal(newFindings.find((finding) => metricOf(finding) === 'route.home.requests').severity, 'medium');
      }
    });

    await t.test('two sides take timing turns that never overlap', { timeout: 180000 }, async () => {
      const gate = createTimingGate(2);
      const turns = [];
      const gated = () => {
        const real = gate.side();
        return { ...real, turn: (fn) => real.turn(async () => { const turn = { start: globalThis.performance.now() }; turns.push(turn); try { return await fn(); } finally { turn.end = globalThis.performance.now(); } }) };
      };
      const [one, two] = await Promise.all([side({ timingGate: gated() }), side({ timingGate: gated() })]);
      for (const run of [one, two]) assert.equal(run.perf.timingError, null);
      assert.equal(turns.length, 12); // 5 page loads + 1 interaction run per side
      turns.sort((a, b) => a.start - b.start);
      turns.slice(1).forEach((turn, i) => assert.ok(turn.start >= turns[i].end, 'turns overlap'));
    });

    await t.test('a side that never arrives does not block the other', { timeout: 180000 }, async () => {
      const gate = createTimingGate(2);
      const [one, absent] = [gate.side(), gate.side()];
      absent.done();
      const run = await side({ timingGate: one });
      assert.equal(run.perf.timingError, null);
      assert.equal(Object.keys(run.perf.timings).length, 2);
    });

    await t.test('without web.performance nothing is measured', async () => {
      const run = await side({ config: (dir) => webConfig(dir, false) });
      assert.equal(run.summary.performance, undefined);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

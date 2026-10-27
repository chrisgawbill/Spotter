import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  absoluteBudgetFindings, aggregate, budgetMetrics, createTimingGate, measureBuild, normalizePerformance,
  performanceProblems, relativeBudgetFindings, routeMetrics, summarizePerformance, timingIncreased,
} from '../src/performance.mjs';

const web = (performance, extra = {}) => ({ routes: ['home', { name: 'about', path: '/about' }], specs: { dir: 'e2e' }, performance, ...extra });
const valid = {
  budgets: [
    { metric: 'build.js', max: 250000 },
    { metric: 'route.*.requests', maxIncrease: '20%', blocking: true },
    { metric: 'timing.home.load', maxIncrease: 200 },
    { metric: 'interaction.open dialog', max: 300 },
  ],
  timings: { samples: 5, routes: ['home'], interactions: { grep: '@perf' } },
};
const problems = (performance, extra) => performanceProblems(web(performance, extra));
const budget = (item) => ({ budgets: [item] });

test('validation accepts the example and absent config', () => {
  assert.deepEqual(problems(valid), []);
  assert.deepEqual(performanceProblems({ routes: ['home'] }), []);
});

test('validation rejects bad shapes', () => {
  assert.ok(problems({ ...valid, extra: 1 }).length);
  assert.ok(problems({ budgets: [] }).length);
  assert.ok(problems(budget({ metric: 'build.js' })).length);
  assert.ok(problems(budget({ metric: 'build.js', max: 1, extra: 1 })).length);
  assert.ok(problems(budget({ metric: 'build.js', max: -1 })).length);
  assert.ok(problems(budget({ metric: 'build.js', maxIncrease: '10 %' })).length);
  assert.ok(problems(budget({ metric: 'build.js', maxIncrease: 'x%' })).length);
  assert.ok(problems(budget({ metric: 'build.js', max: 1, blocking: 'yes' })).length);
  assert.ok(problems(budget({ metric: 'build.video', max: 1 })).length);
  assert.ok(problems(budget({ metric: 'route.home.latency', max: 1 })).length);
  assert.ok(problems(budget({ metric: 'route.missing.requests', max: 1 })).length);
  assert.deepEqual(problems(budget({ metric: 'route.about.bytes', max: 1 })), []);
});

test('validation of timing, interaction and samples metrics', () => {
  assert.ok(problems(budget({ metric: 'timing.home.load', max: 1 })).length);
  assert.ok(problems({ ...budget({ metric: 'timing.about.load', max: 1 }), timings: { routes: ['home'] } }).length);
  assert.ok(problems(budget({ metric: 'interaction.x', max: 1 })).length);
  assert.ok(problems({ ...budget({ metric: 'interaction.', max: 1 }), timings: { interactions: { grep: 'a' } } }).length);
  assert.ok(problems({ ...budget({ metric: 'build.js', max: 1 }), timings: { interactions: { grep: 'a' } } }, { specs: undefined }).length);
  assert.ok(problems({ ...budget({ metric: 'build.js', max: 1 }), timings: {} }).length);
  assert.ok(problems({ ...budget({ metric: 'build.js', max: 1 }), timings: { routes: ['nope'] } }).length);
  for (const samples of [2, 21, 4.5, '5']) assert.ok(problems({ ...budget({ metric: 'build.js', max: 1 }), timings: { routes: ['home'], samples } }).length, String(samples));
  for (const samples of [3, 20]) assert.deepEqual(problems({ ...budget({ metric: 'build.js', max: 1 }), timings: { routes: ['home'], samples } }), []);
});

test('normalization', () => {
  assert.equal(normalizePerformance(undefined), null);
  const normalized = normalizePerformance(valid);
  assert.deepEqual(normalized.budgets[0], { metric: 'build.js', max: 250000, maxIncrease: null, blocking: false });
  assert.deepEqual(normalized.budgets[1].maxIncrease, { percent: 20 });
  assert.equal(normalized.budgets[1].blocking, true);
  assert.deepEqual(normalized.budgets[2].maxIncrease, { amount: 200 });
  assert.deepEqual(normalizePerformance(budget({ metric: 'build.js', max: 1 })), { budgets: [{ metric: 'build.js', max: 1, maxIncrease: null, blocking: false }], timings: null });
  assert.deepEqual(normalizePerformance({ ...budget({ metric: 'build.js', max: 1 }), timings: { interactions: { grep: 'a' } } }).timings, { samples: 5, routes: [], interactions: { grep: 'a' } });
  assert.deepEqual(normalized.timings, { samples: 5, routes: ['home'], interactions: { grep: '@perf' } });
});

test('measureBuild categorises, gzips text, keeps binary raw and skips maps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'perf-'));
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'app.js'), 'a'.repeat(10000));
    await writeFile(join(dir, 'app.js.map'), 'm'.repeat(5000));
    await writeFile(join(dir, 'style.css'), 'b{}'.repeat(1000));
    await writeFile(join(dir, 'logo.png'), Buffer.alloc(700, 1));
    await writeFile(join(dir, 'icon.svg'), '<svg/>'.repeat(1000));
    await writeFile(join(dir, 'f.woff2'), Buffer.alloc(300, 2));
    await writeFile(join(dir, 'data.bin'), Buffer.alloc(50, 3));
    const sizes = await measureBuild(dir);
    assert.ok(sizes['build.js'] > 0 && sizes['build.js'] < 200);
    assert.ok(sizes['build.css'] > 0 && sizes['build.css'] < 200);
    assert.equal(sizes['build.fonts'], 300);
    assert.equal(sizes['build.other'], 50);
    assert.ok(sizes['build.images'] > 700 && sizes['build.images'] < 900);
    assert.equal(sizes['build.total'], sizes['build.js'] + sizes['build.css'] + sizes['build.images'] + sizes['build.fonts'] + sizes['build.other']);
    const empty = await mkdtemp(join(tmpdir(), 'perf-empty-'));
    assert.deepEqual(await measureBuild(empty), { 'build.js': 0, 'build.css': 0, 'build.images': 0, 'build.fonts': 0, 'build.other': 0, 'build.total': 0 });
    await rm(empty, { recursive: true });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('routeMetrics and aggregate', () => {
  assert.deepEqual(routeMetrics('home', { requests: 3, apiRequests: 1, bytes: 10, imageBytes: 4 }), {
    'route.home.requests': 3, 'route.home.apiRequests': 1, 'route.home.bytes': 10, 'route.home.imageBytes': 4,
  });
  assert.deepEqual(aggregate([30, 10, 20]), { median: 20, min: 10, max: 30, samples: [30, 10, 20] });
  assert.equal(aggregate([10, 20, 30, 41]).median, 25);
  assert.equal(aggregate([1.04, 1.04, 1.04]).median, 1);
});

test('budgetMetrics expands wildcards', () => {
  const names = ['build.js', 'route.home.requests', 'route.about.requests', 'route.home.bytes', 'timing.home.load', 'timing.about.load', 'interaction.open dialog'];
  assert.deepEqual(budgetMetrics({ metric: 'route.*.requests' }, names), ['route.home.requests', 'route.about.requests']);
  assert.deepEqual(budgetMetrics({ metric: 'timing.*.load' }, names), ['timing.home.load', 'timing.about.load']);
  assert.deepEqual(budgetMetrics({ metric: 'build.js' }, names), ['build.js']);
  assert.deepEqual(budgetMetrics({ metric: 'interaction.open dialog' }, names), ['interaction.open dialog']);
  assert.deepEqual(budgetMetrics({ metric: 'build.css' }, names), []);
});

const env = { browser: 'chromium 1', cpus: 4, api: 'replayed', samples: 5 };
const timing = (median, min = median, max = median) => ({ median, min, max, samples: [min, median, max, median, median] });
const measured = (resources, timings = null, environment = timings ? env : null) => ({ resources, timings, environment, timingError: null });
const config = (...budgets) => normalizePerformance({ budgets, timings: { routes: ['home'] } });

test('absolute findings compare against max with severity', () => {
  const cfg = config({ metric: 'build.js', max: 1000 }, { metric: 'route.*.requests', max: 5, blocking: true });
  const found = absoluteBudgetFindings(cfg, measured({ 'build.js': 1500, 'route.home.requests': 5, 'route.about.requests': 6 }), { project: 'p' });
  assert.equal(found.length, 2);
  assert.equal(found[0].title, 'performance budget exceeded: build.js is 1.5 kB (max 1.0 kB)');
  assert.equal(found[0].severity, 'low');
  assert.equal(found[0].detail, null);
  assert.equal(found[0].repro, null);
  assert.equal(found[1].title, 'performance budget exceeded: route.about.requests is 6 (max 5)');
  assert.equal(found[1].severity, 'medium');
  assert.deepEqual(absoluteBudgetFindings(cfg, measured({ 'build.js': 1000, 'route.home.requests': 4 }), {}), []);
  assert.equal(absoluteBudgetFindings(config({ metric: 'build.js', max: 600 }), measured({ 'build.js': 512 }), {}).length, 0);
  assert.match(absoluteBudgetFindings(config({ metric: 'build.js', max: 100 }), measured({ 'build.js': 512 }), {})[0].title, /is 512 B \(max 100 B\)/);
});

test('absolute timing findings use the median and describe the environment', () => {
  const cfg = config({ metric: 'timing.home.load', max: 100 });
  const slow = measured({}, { 'timing.home.load': timing(150, 90, 200) });
  const [finding] = absoluteBudgetFindings(cfg, slow, { project: 'demo' });
  assert.equal(finding.title, 'performance budget exceeded: timing.home.load is 150.0 ms (max 100.0 ms)');
  assert.equal(finding.detail, 'median of 5 samples (90.0–200.0); chromium 1, 4 CPUs; API responses replayed — front-end timing, not backend performance');
  assert.equal(finding.repro, 'spotter run demo --level high');
  assert.equal(finding.stage, 'web');
  assert.equal(finding.check, 'performance-budget');
  assert.equal(absoluteBudgetFindings(cfg, measured({}, { 'timing.home.load': timing(99, 50, 400) }), {}).length, 0);
  const none = measured({}, { 'timing.home.load': timing(150) }, { ...env, api: 'none' });
  assert.match(absoluteBudgetFindings(cfg, none, {})[0].detail, /; API not used$/);
});

test('finding id ignores measured values', () => {
  const cfg = config({ metric: 'build.js', max: 1000 });
  const [a] = absoluteBudgetFindings(cfg, measured({ 'build.js': 1500 }), {});
  const [b] = absoluteBudgetFindings(cfg, measured({ 'build.js': 99000 }), {});
  assert.equal(a.id, b.id);
  const other = config({ metric: 'build.css', max: 1000 });
  assert.notEqual(a.id, absoluteBudgetFindings(other, measured({ 'build.css': 1500 }), {})[0].id);
});

test('relative resource findings', () => {
  const pct = config({ metric: 'build.js', maxIncrease: '10%' });
  const flags = (cfg, head, base) => relativeBudgetFindings(cfg, measured(head), measured(base), { baseCached: false });
  assert.equal(flags(pct, { 'build.js': 1100 }, { 'build.js': 1000 }).findings.length, 0);
  const [finding] = flags(pct, { 'build.js': 1101 }, { 'build.js': 1000 }).findings;
  assert.equal(finding.title, 'performance regression: build.js rose from 1.0 kB to 1.1 kB (allowed +10%)');
  assert.equal(finding.severity, 'low');
  const amount = config({ metric: 'route.home.requests', maxIncrease: 2, blocking: true });
  assert.equal(flags(amount, { 'route.home.requests': 7 }, { 'route.home.requests': 5 }).findings.length, 0);
  const over = flags(amount, { 'route.home.requests': 8 }, { 'route.home.requests': 5 }).findings[0];
  assert.equal(over.title, 'performance regression: route.home.requests rose from 5 to 8 (allowed +2)');
  assert.equal(over.severity, 'medium');
  assert.equal(flags(pct, { 'build.js': 1 }, { 'build.js': 0 }).findings.length, 1);
  assert.equal(flags(pct, { 'build.js': 0 }, { 'build.js': 0 }).findings.length, 0);
});

test('relative timing noise rule', () => {
  const cfg = config({ metric: 'timing.home.load', maxIncrease: 10 });
  const run = (head, base, options = {}) => relativeBudgetFindings(cfg, measured({}, { 'timing.home.load': head }), measured({}, { 'timing.home.load': base }), { baseCached: false, project: 'p', ...options });
  assert.equal(timingIncreased(timing(200, 150, 250), timing(100, 80, 160), { amount: 10 }), false);
  assert.equal(run(timing(200, 150, 250), timing(100, 80, 160)).findings.length, 0);
  assert.equal(run(timing(105, 101, 110), timing(100, 90, 100)).findings.length, 0);
  const [finding] = run(timing(200, 190, 210), timing(100, 90, 100)).findings;
  assert.equal(finding.title, 'performance regression: timing.home.load rose from 100.0 ms to 200.0 ms (allowed +10.0 ms)');
  assert.equal(finding.repro, 'spotter run p --level high');
  assert.match(finding.detail, /^median of 5 samples/);
});

test('relative not-compared reasons', () => {
  const cfg = config({ metric: 'timing.home.load', maxIncrease: 10 }, { metric: 'build.js', maxIncrease: 10 });
  const head = measured({ 'build.js': 2000 }, { 'timing.home.load': timing(200, 190, 210) });
  const base = measured({ 'build.js': 1000 }, { 'timing.home.load': timing(100, 90, 100) });
  const reasons = (result) => result.notCompared.map((item) => `${item.metric}: ${item.reason}`);
  const cached = relativeBudgetFindings(cfg, head, base, { baseCached: true });
  assert.deepEqual(reasons(cached), ['timing.home.load: cached base']);
  assert.equal(cached.findings.length, 1);
  const other = { ...base, environment: { ...env, cpus: 8 } };
  assert.deepEqual(reasons(relativeBudgetFindings(cfg, head, other, { baseCached: false })), ['timing.home.load: different environment']);
  assert.deepEqual(reasons(relativeBudgetFindings(cfg, head, measured({}, null), { baseCached: false })), ['timing.home.load: not measured on base', 'build.js: not measured on base']);
  const missing = relativeBudgetFindings(cfg, head, measured({}, { 'timing.home.load': timing(100, 90, 100) }), { baseCached: false });
  assert.deepEqual(reasons(missing), ['build.js: not measured on base']);
  const none = relativeBudgetFindings(cfg, head, null, { baseCached: false });
  assert.deepEqual(reasons(none), ['timing.home.load: no baseline', 'build.js: no baseline']);
  assert.deepEqual(none.findings, []);
});

test('summarizePerformance', () => {
  const budgets = config({ metric: 'build.js', maxIncrease: 10 }, { metric: 'timing.home.load', maxIncrease: 10, blocking: true }, { metric: 'build.css', max: 1 }).budgets;
  const head = measured({ 'build.js': 1, 'build.css': 1 }, { 'timing.home.load': timing(1) });
  const run = (extra) => ({ performance: { budgets, head, base: head, notCompared: [], ...extra } });
  const lead = 'performance: 3 metrics, 3 budgets (1 blocking) · timings 5 samples';
  assert.equal(summarizePerformance(run()), `${lead} · compared with base`);
  assert.equal(summarizePerformance(run({ base: null, notCompared: [{ metric: 'build.js', reason: 'no baseline' }] })), `${lead} · not compared (no baseline)`);
  assert.equal(summarizePerformance(run({ notCompared: [{ metric: 'timing.home.load', reason: 'cached base' }] })), `${lead} · timings not compared (cached base)`);
  assert.equal(summarizePerformance(run({ notCompared: [{ metric: 'timing.home.load', reason: 'different environment' }] })), `${lead} · timings not compared (different environment)`);
  assert.equal(summarizePerformance(run({ notCompared: [{ metric: 'build.js', reason: 'not measured on base' }] })), `${lead} · 1 metrics not on base`);
  const resourceOnly = measured({ 'build.js': 1 });
  assert.equal(summarizePerformance(run({ head: resourceOnly })), 'performance: 1 metrics, 3 budgets (1 blocking) · compared with base');
  assert.match(summarizePerformance(run({ head: { ...resourceOnly, timingError: 'boom' } })), / · timings failed: boom · /);
});

test('timing gate waits for both parties and serialises turns', async () => {
  const gate = createTimingGate(2);
  const [a, b] = [gate.side(), gate.side()];
  let released = false;
  const waiting = a.arrive().then(() => { released = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, false);
  await b.arrive();
  await waiting;
  assert.equal(released, true);
  const log = [];
  const turn = (side, name) => side.turn(async () => {
    log.push(`${name}:start`);
    await new Promise((resolve) => setImmediate(resolve));
    log.push(`${name}:end`);
  });
  await Promise.all([turn(a, 'a1'), turn(b, 'b1'), turn(a, 'a2')]);
  assert.deepEqual(log, ['a1:start', 'a1:end', 'b1:start', 'b1:end', 'a2:start', 'a2:end']);
  await assert.rejects(a.turn(() => { throw new Error('x'); }), /x/);
  assert.equal(await b.turn(() => 7), 7);
});

test('timing gate: done releases the other side and is idempotent', async () => {
  const gate = createTimingGate(2);
  const [a, b] = [gate.side(), gate.side()];
  const waiting = a.arrive();
  b.done();
  b.done();
  await waiting;
  const solo = createTimingGate(2);
  const [x, y] = [solo.side(), solo.side()];
  x.done();
  x.done();
  let released = false;
  const pending = y.arrive().then(() => { released = true; });
  await pending;
  assert.equal(released, true);
  const strict = createTimingGate(2);
  const [p] = [strict.side(), strict.side()];
  p.arrive();
  p.arrive();
  let early = false;
  p.arrive().then(() => { early = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(early, false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessBaseline, assessCompleteness, describeFixtures, requirableNames, summarizeCompleteness } from '../src/completeness.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-23T00:00:00Z');
const fixtures = { recordedAt: '2026-10-20T00:00:00Z', hash: 'a1b2c3d4e5', ref: 'main', sha: '0123456789abcdef' };
const base = (extra = {}) => ({
  name: 'demo',
  checks: [{ name: 'typecheck' }, { name: 'test' }],
  coverage: { required: [], minSpecs: null },
  web: {
    routes: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], viewports: [375, 1280], colorSchemes: ['light'], browsers: ['chromium'], devices: [],
    sessions: [{ name: 'anonymous' }, { name: 'member', expectSelector: '#me' }],
    api: {}, specs: { files: ['x'] },
  },
  ...extra,
});
const web = (extra = {}, specs = {}) => ({
  built: true, pages: 12, faultVisits: 0, pagesFailed: 0, faultVisitsFailed: 0,
  sessionChecks: { member: { checked: 6, failed: 0, examples: [] } },
  specs: { mode: 'replay', passed: 24, failed: 0, skipped: 0, flaky: 0, selected: 24, completed: true, ...specs },
  ...extra,
});
const stages = (w = web()) => ({ static: [{ name: 'typecheck', status: 'PASS' }, { name: 'test', status: 'PASS' }], rules: [], web: w });
const none = { status: 'cached', reason: null };
const assess = (o = {}) => assessCompleteness({ config: base(), skip: new Set(), stages: stages(), fixtures, baseline: none, liveAuth: false, now: NOW, ...o });
const item = (c, name) => c.items.find((i) => i.name === name);

test('healthy run is complete with a C7 summary', () => {
  const c = assess({ config: base({ coverage: { required: [], minSpecs: 20 } }) });
  assert.equal(c.status, 'complete');
  assert.deepEqual(c.gaps, []);
  assert.deepEqual(c.counts.pages, { expected: 12, executed: 12, failed: 0, skipped: 0 });
  assert.equal(c.counts.faultVisits, null);
  assert.equal(c.level, null);
  assert.equal(summarizeCompleteness(c), 'COMPLETE · 12/12 configured page visits loaded · specs 24 of 24 executed (min 20) · baseline cached · fixtures 2026-10-20 (3d old, a1b2c3d4e5)');
});

test('install failure leaves checks and web missing', () => {
  const s = { static: [{ name: 'install', status: 'FAIL' }], rules: [], web: 'skipped' };
  const c = assess({ stages: s });
  assert.equal(c.status, 'incomplete');
  for (const name of ['typecheck', 'test', 'web', 'specs', 'member']) assert.deepEqual([item(c, name).status, item(c, name).reason], ['missing', 'dependency install failed']);
  assert.deepEqual(c.counts.pages, { expected: 12, executed: 0, failed: 0, skipped: 12 });
  assert.equal(c.counts.specs, null);
});

test('web build failure marks web and specs missing', () => {
  const c = assess({ stages: stages({ built: false, pages: 0 }) });
  assert.equal(item(c, 'web').reason, 'build failed');
  assert.equal(item(c, 'specs').reason, 'build failed');
  assert.ok(c.gaps.includes('web: build failed') && c.gaps.includes('specs: build failed'));
});

test('specs problems are missing', () => {
  assert.equal(item(assess({ stages: stages(web({}, { selected: 0, completed: true })) }), 'specs').reason, 'selected zero tests');
  const c = assess({ stages: stages(web({}, { selected: 3, completed: false })) });
  assert.equal(item(c, 'specs').reason, 'runner could not complete');
  assert.ok(c.gaps.includes('specs: runner could not complete'));
  const old = web(); delete old.specs;
  assert.equal(item(assess({ stages: stages(old) }), 'specs').reason, 'did not run');
});

test('session expectSelector failures give the exact reason', () => {
  const c = assess({ stages: stages(web({ sessionChecks: { member: { checked: 4, failed: 2, examples: [] } } })) });
  assert.equal(item(c, 'member').reason, 'expected state not reached on 2/4 visits (#me not found)');
  assert.equal(c.gaps[0], 'member: expected state not reached on 2/4 visits (#me not found)');
  assert.equal(item(assess({ stages: stages(web({ sessionChecks: {} })) }), 'member').reason, 'not visited');
});

test('--skip static skips checks; required skipped is a gap', () => {
  const skip = new Set(['static']);
  const c = assess({ skip });
  assert.equal(item(c, 'typecheck').status, 'skipped');
  assert.equal(c.status, 'complete');
  assert.match(summarizeCompleteness(c), /skipped: typecheck \(--skip static\), test \(--skip static\)$/);
  const r = assess({ skip, config: base({ coverage: { required: ['typecheck'], minSpecs: null } }) });
  assert.equal(r.status, 'incomplete');
  assert.deepEqual(r.gaps, ['typecheck: required but skipped (--skip static)']);
  assert.ok(!summarizeCompleteness(r).includes('typecheck ('));
});

test('minSpecs above executed is a gap', () => {
  const c = assess({ config: base({ coverage: { required: [], minSpecs: 30 } }) });
  assert.deepEqual(c.gaps, ['specs: 24 executed, minimum 30']);
  const skipped = assess({ config: base({ coverage: { required: [], minSpecs: 30 } }), stages: stages(web({}, { skipped: 4 })) });
  assert.equal(skipped.counts.specs.executed, 20);
});

test('failed page and fault visits are counted', () => {
  const c = assess({ stages: stages(web({ pagesFailed: 2, faultVisits: 4, faultVisitsFailed: 1 })) });
  assert.deepEqual(c.counts.pages, { expected: 12, executed: 10, failed: 2, skipped: 0 });
  assert.deepEqual(c.counts.faultVisits, { executed: 3, failed: 1 });
  assert.deepEqual(c.gaps, ['2 of 12 page visits failed to load', '1 fault visits failed to load']);
});

test('missing fixtures with web.api is a gap', () => {
  const c = assess({ fixtures: null });
  assert.equal(item(c, 'fixtures').reason, 'no fixtures recorded; run spotter record demo');
  assert.equal(c.fixtures, null);
  assert.equal(c.status, 'incomplete');
});

test('live authentication skips web and drops fixtures', () => {
  const s = { static: [], rules: 'skipped', web: { pages: 0, specs: web().specs } };
  const c = assess({ liveAuth: true, stages: s, skip: new Set(), baseline: assessBaseline({ config: base(), skip: new Set(), liveAuth: true }) });
  assert.equal(item(c, 'web').status, 'skipped');
  assert.equal(item(c, 'fixtures'), undefined);
  assert.equal(item(c, 'member').reason, 'live authentication');
  assert.equal(c.baseline.status, 'none');
  assert.equal(c.counts.pages, null);
});

test('assessBaseline outcomes', () => {
  const config = base();
  const o = { config, skip: new Set(), headStages: stages(), baseStages: stages(), baseSha: 'b', headSha: 'h', workingTree: false, cached: false };
  assert.deepEqual(assessBaseline({ ...o, baseSha: null }), { status: 'none', reason: 'disabled by --no-baseline' });
  assert.deepEqual(assessBaseline({ ...o, baseSha: 'h' }), { status: 'same-commit', reason: null });
  assert.equal(assessBaseline({ ...o, baseSha: 'h', workingTree: true }).status, 'compared');
  assert.deepEqual(assessBaseline({ ...o, error: new Error('boom\nstack') }), { status: 'failed', reason: 'base run failed: boom' });
  assert.deepEqual(assessBaseline({ ...o, baseStages: stages('skipped') }), { status: 'failed', reason: 'base did not run: web' });
  assert.deepEqual(assessBaseline({ ...o, baseStages: { ...stages(), static: [{ name: 'test' }] } }), { status: 'failed', reason: 'base did not run: typecheck' });
  const noSpecs = web(); delete noSpecs.specs; delete noSpecs.sessionChecks;
  assert.deepEqual(assessBaseline({ ...o, baseStages: stages(noSpecs), cached: true }), { status: 'cached', reason: null });
  assert.deepEqual(assessBaseline(o), { status: 'compared', reason: null });
  assert.equal(assess({ baseline: { status: 'failed', reason: 'base did not run: web' } }).gaps.at(-1), 'baseline: base did not run: web');
});

test('describeFixtures and requirableNames', () => {
  assert.equal(describeFixtures(null), null);
  assert.deepEqual(describeFixtures({ recordedAt: '2026-10-20T00:00:00Z', hash: 'h', sha: '0123456789' }, NOW + DAY / 2), { recordedAt: '2026-10-20T00:00:00Z', hash: 'h', ref: null, sha: '0123456', ageDays: 3 });
  assert.equal(describeFixtures(fixtures, NOW).ageDays, 3);
  assert.deepEqual(requirableNames({ checks: [{ name: 'a' }], web: { routes: ['/'], api: {}, specs: {}, sessions: [{ name: 'm', expectSelector: 'x' }, { name: 'n' }] } }), ['a', 'rules', 'web', 'fixtures', 'specs', 'm']);
  assert.deepEqual(requirableNames({}), ['rules']);
});

test('level exclusions are listed, never gaps, and shown in the summary', () => {
  const exclusions = [{ name: 'rules', kind: 'stage', reason: 'excluded at level low' }, { name: 'lint', kind: 'check', reason: 'excluded at level low' }];
  const level = { name: 'low', source: 'selected', exclusions, unsupported: [] };
  const c = assess({ level, skip: new Set(['rules']), stages: { ...stages(), rules: 'skipped' } });
  assert.equal(c.status, 'complete');
  assert.deepEqual(c.gaps, []);
  assert.equal(c.level, level);
  assert.deepEqual(c.items.slice(-2), [
    { name: 'rules', kind: 'stage', required: false, status: 'excluded', reason: 'excluded at level low' },
    { name: 'lint', kind: 'check', required: false, status: 'excluded', reason: 'excluded at level low' },
  ]);
  assert.equal(c.items.filter((i) => i.name === 'rules').length, 1);
  const summary = summarizeCompleteness(c);
  assert.match(summary, /^COMPLETE · level low · /);
  assert.match(summary, /2 excluded by level$/);
  assert.equal(summarizeCompleteness(assess()), summarizeCompleteness({ ...assess(), level: null }));
  assert.doesNotMatch(summarizeCompleteness(assess()), /level/);
});

test('an excluded route does not hide a coverage item with the same name', () => {
  const level = { name: 'low', source: 'selected', exclusions: [{ name: 'web', kind: 'route', reason: 'excluded at level low' }], unsupported: [] };
  const c = assess({ level });
  assert.equal(c.items.find((i) => i.name === 'web' && i.kind === 'stage').status, 'executed');
});

test('API traffic that was not replayed is an incomplete-coverage gap', () => {
  const c = assess({ stages: stages(web({ apiNotReplayed: ['GET /api/items'] })) });
  assert.equal(c.status, 'incomplete');
  assert.deepEqual(c.gaps, ['API traffic not replayed: GET /api/items; configure web.api.paths and run spotter record demo']);
});

test('more than three not-replayed endpoints are summarised', () => {
  const list = ['GET /a', 'GET /b', 'GET /c', 'GET /d', 'GET /e'];
  const c = assess({ stages: stages(web({ apiNotReplayed: list })) });
  assert.deepEqual(c.gaps, ['API traffic not replayed: GET /a, GET /b, GET /c and 2 more; configure web.api.paths and run spotter record demo']);
});

test('no not-replayed list, an empty one or skipped web adds no API gap', () => {
  assert.deepEqual(assess({ stages: stages(web({ apiNotReplayed: [] })) }).gaps, []);
  assert.deepEqual(assess().gaps, []);
  assert.ok(!assess({ stages: stages('skipped') }).gaps.some((g) => g.startsWith('API traffic')));
  assert.ok(!assess({ stages: stages(undefined) }).gaps.some((g) => g.startsWith('API traffic')));
});

test('the API gap does not depend on web.api being configured', () => {
  const config = base();
  delete config.web.api;
  const c = assess({ config, stages: stages(web({ apiNotReplayed: ['POST /api/x'] })) });
  assert.ok(c.gaps.includes('API traffic not replayed: POST /api/x; configure web.api.paths and run spotter record demo'));
});

test('fixtures with no data add a coverage note without changing completeness', () => {
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const empty = { ...fixtures, entries: { 'GET /a': json([]), 'GET /b': json({ title: 'Not Found' }, 404) } };
  const legacy = assess({ fixtures: empty });
  assert.equal(legacy.status, 'complete');
  assert.deepEqual(legacy.gaps, []);
  assert.deepEqual(legacy.notes, ['fixtures hold no data; pages show empty states only (1 empty, 1 4xx responses). Record from an API with data and run spotter record demo']);
  assert.match(assess({ fixtures: { ...empty, summary: { data: 0, empty: 1, clientErrors: 1, seeded: false } } }).notes[0], /Seed the recording backend \(or set web\.api\.backend\.seeded when it seeds itself\) and run spotter record demo$/);
  assert.match(assess({ fixtures: { ...empty, summary: { data: 0, empty: 1, clientErrors: 1, seeded: true } } }).notes[0], /Check the recording backend's seed step/);
  assert.deepEqual(assess({ fixtures: { ...empty, entries: { ...empty.entries, 'GET /c': json([{ id: 1 }]) } } }).notes, []);
  assert.deepEqual(assess({ fixtures: { ...empty, summary: { data: 3, empty: 0, clientErrors: 0, seeded: true } } }).notes, []);
  assert.deepEqual(assess().notes, []);
  assert.deepEqual(assess({ fixtures: null }).notes, []);
});

test('expected pages count browsers and devices', () => {
  const config = base();
  config.web.browsers = ['chromium', 'firefox'];
  config.web.devices = ['iPhone 13'];
  assert.equal(assess({ config }).counts.pages.expected, 2 * 12 + 6);
});

test('performance is requirable and reported as executed, a gap, or a note', () => {
  const perfConfig = (required = []) => base({ coverage: { required, minSpecs: null }, web: { ...base().web, performance: { budgets: [] } } });
  assert.ok(requirableNames(perfConfig()).includes('performance'));
  assert.ok(!requirableNames(base()).includes('performance'));
  const measured = assess({ config: perfConfig(), stages: stages(web({ performance: { resources: {}, timingError: null } })) });
  assert.equal(item(measured, 'performance').status, 'executed');
  const missing = assess({ config: perfConfig(['performance']), stages: stages(web({ performance: { resources: {}, timingError: 'boom' } })) });
  assert.equal(item(missing, 'performance').status, 'missing');
  assert.equal(missing.status, 'incomplete');
  assert.deepEqual(missing.gaps, ['performance: timings failed: boom']);
  const optional = assess({ config: perfConfig() });
  assert.equal(item(optional, 'performance').status, 'skipped');
  assert.equal(optional.status, 'complete');
  assert.deepEqual(optional.notes, ['performance: not measured']);
  assert.equal(item(assess(), 'performance'), undefined);
  const excluded = assess({ config: perfConfig(), level: { name: 'low', exclusions: [{ name: 'performance', kind: 'performance', reason: 'excluded at level low' }] } });
  assert.equal(item(excluded, 'performance').status, 'excluded');
});

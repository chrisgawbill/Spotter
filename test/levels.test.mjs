import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig } from '../src/config.mjs';
import { FAULT_KINDS, HIGH_DEVICES, UNSUPPORTED_AT_HIGH, resolvePlan, summarizePlan } from '../src/levels.mjs';

const make = ({ levels, required = ['typecheck'], minSpecs, web = {} } = {}) => normalizeConfig({
  repo: '/tmp/app',
  checks: [{ name: 'typecheck', run: 'a' }, { name: 'unit', run: 'b' }, { name: 'format', run: 'c' }],
  coverage: { required, ...(minSpecs ? { minSpecs } : {}) },
  levels: levels ?? { low: { routes: ['home'] } },
  web: {
    build: { run: 'true' }, routes: ['home', 'about', 'more'], viewports: [375, { width: 1280, height: 900 }],
    colorSchemes: ['light', 'dark'], specs: { files: ['a.spec.mjs'], grep: 'all' }, ...web,
  },
}, { projectName: 'demo' });
const E = (name, kind) => ({ name, kind, reason: 'excluded at level low' });

test('no level and no default leaves the config untouched', () => {
  const config = make({ levels: { low: { routes: ['home'] } } });
  const plan = resolvePlan(config, undefined);
  assert.equal(plan.config, config);
  assert.equal(plan.skip.size, 0);
  assert.equal(plan.record, null);
  assert.equal(resolvePlan(config, '').record, null);
});

test('medium selects the full run', () => {
  const config = make();
  const plan = resolvePlan(config, 'medium');
  assert.equal(plan.config, config);
  assert.deepEqual(plan.record, { name: 'medium', source: 'selected', exclusions: [], unsupported: [] });
});

test('high is medium plus the browser matrix and the unsupported list', () => {
  const config = make();
  const plan = resolvePlan(config, 'high');
  assert.deepEqual({ ...plan.config, web: { ...plan.config.web, browsers: config.web.browsers, devices: config.web.devices, faultInjection: config.web.faultInjection } }, config);
  assert.deepEqual(UNSUPPORTED_AT_HIGH.map((item) => item.ticket), ['QA-13', 'QA-15']);
  assert.deepEqual(plan.record.unsupported, UNSUPPORTED_AT_HIGH);
  assert.deepEqual(plan.record.exclusions, []);
});

test('levels.default applies until a level is selected', () => {
  const config = make({ levels: { default: 'low', low: { routes: ['home'] } } });
  assert.deepEqual(resolvePlan(config, undefined).record.source, 'default');
  assert.equal(resolvePlan(config, undefined).record.name, 'low');
  const medium = resolvePlan(config, 'medium');
  assert.equal(medium.record.name, 'medium');
  assert.equal(medium.record.source, 'selected');
  assert.equal(medium.config, config);
});

test('unknown and unconfigured levels throw', () => {
  const config = make({ levels: { default: 'medium' } });
  assert.throws(() => resolvePlan(config, 'fast'), { message: 'Unknown level "fast"; use low, medium or high' });
  assert.throws(() => resolvePlan(config, 'low'), { message: 'Level low is not configured; add levels.low to projects/demo.yml' });
});

test('low narrows checks, routes, matrix, faults and specs without mutating the input', () => {
  const config = make({ levels: { low: { routes: ['home', 'more'] } } });
  const before = JSON.stringify(config);
  const plan = resolvePlan(config, 'low');
  assert.equal(JSON.stringify(config), before);
  assert.notEqual(plan.config, config);
  assert.deepEqual(plan.config.checks.map((c) => c.name), ['typecheck']);
  assert.deepEqual([...plan.skip], ['rules', 'config']);
  assert.deepEqual(plan.config.web.routes.map((r) => r.name), ['home', 'more']);
  assert.deepEqual(plan.config.web.viewports, [375]);
  assert.deepEqual(plan.config.web.colorSchemes, ['light']);
  assert.equal(plan.config.web.faultInjection, null);
  assert.equal(plan.config.web.specs, undefined);
  assert.equal(plan.config.web.sessions, config.web.sessions);
  assert.deepEqual(plan.record.exclusions, [
    E('unit', 'check'), E('format', 'check'), E('rules', 'stage'), E('config', 'stage'), E('about', 'route'),
    E('1280', 'viewport'), E('dark', 'colorScheme'), E('fault visits', 'faults'), E('specs', 'specs'),
  ]);
  assert.deepEqual(plan.record.unsupported, []);
});

test('required items survive low and narrowed specs drop minSpecs', () => {
  const kept = resolvePlan(make({ required: ['rules', 'specs'], minSpecs: 2 }), 'low');
  assert.deepEqual([...kept.skip], ['config']);
  assert.deepEqual(kept.config.web.specs, { files: ['a.spec.mjs'], grep: 'all' });
  assert.equal(kept.config.coverage.minSpecs, 2);
  assert.ok(!kept.record.exclusions.some((e) => ['rules', 'specs', 'minSpecs'].includes(e.name)));
  assert.deepEqual(kept.config.checks, []);

  const levels = { low: { routes: ['home'], specs: { grep: '@smoke' } } };
  const narrowed = resolvePlan(make({ levels, minSpecs: 2 }), 'low');
  assert.deepEqual(narrowed.config.web.specs, { files: ['a.spec.mjs'], grep: '@smoke' });
  assert.equal(narrowed.config.coverage.minSpecs, null);
  assert.ok(narrowed.record.exclusions.some((e) => e.name === 'minSpecs' && e.kind === 'coverage'));
});

test('plan hash is stable and differs between levels', () => {
  const config = make();
  const low = resolvePlan(config, 'low').hash;
  assert.match(low, /^[0-9a-f]{10}$/);
  assert.equal(resolvePlan(config, 'low').hash, low);
  assert.notEqual(resolvePlan(config, 'medium').hash, low);
});

test('summarizePlan renders low and no-level lines', () => {
  const config = make({ levels: { low: { routes: ['home'] } } });
  assert.equal(summarizePlan(resolvePlan(config, 'low')),
    'level low (selected) · 1 checks · no rules · 1 routes × 1 viewports × 1 schemes × 1 sessions · excluded: unit, format, rules, config, about, more, 1280, dark, fault visits, specs');
  assert.equal(summarizePlan(resolvePlan(config, undefined)),
    'no level · 3 checks · rules · 3 routes × 2 viewports × 2 schemes × 1 sessions + fault visits · specs (grep all)');
  assert.match(summarizePlan(resolvePlan(config, 'high')), /unsupported: data edge cases \(QA-13\), .*performance budgets \(QA-15\)$/);
});

test('high adds every browser and the standard devices to any web project, keeping configured ones first', () => {
  const config = make({ web: { browsers: ['firefox'], devices: ['Galaxy S9+'] } });
  const plan = resolvePlan(config, 'high');
  assert.deepEqual(plan.config.web.browsers, ['firefox', 'chromium', 'webkit']);
  assert.deepEqual(plan.config.web.devices, ['Galaxy S9+', 'iPhone 13', 'Pixel 7']);
  assert.deepEqual(HIGH_DEVICES, ['iPhone 13', 'Pixel 7']);
  assert.deepEqual(plan.record.exclusions, []);
  assert.notEqual(plan.hash, resolvePlan(config, 'medium').hash);
  assert.match(summarizePlan(resolvePlan(make(), 'high')), / · matrix chromium, firefox, webkit, iPhone 13, Pixel 7 · /);
});

test('high leaves a config without web alone', () => {
  const config = normalizeConfig({ repo: '/tmp/app' }, { projectName: 'demo' });
  assert.equal(resolvePlan(config, 'high').config, config);
});

test('low keeps the first browser and drops devices as exclusions', () => {
  const config = make({ web: { browsers: ['firefox', 'webkit'], devices: ['iPhone 13'] } });
  const plan = resolvePlan(config, 'low');
  assert.deepEqual(plan.config.web.browsers, ['firefox']);
  assert.deepEqual(plan.config.web.devices, []);
  const kinds = plan.record.exclusions.filter((item) => item.kind === 'browser' || item.kind === 'device');
  assert.deepEqual(kinds, [E('webkit', 'browser'), E('iPhone 13', 'device')]);
});

test('summarizePlan shows the matrix only when it is not the default', () => {
  assert.doesNotMatch(summarizePlan(resolvePlan(make(), 'medium')), /matrix/);
  const line = summarizePlan(resolvePlan(make({ web: { browsers: ['chromium', 'firefox'], devices: ['iPhone 13'] } }), 'medium'));
  assert.match(line, / · matrix chromium, firefox, iPhone 13 · specs/);
});

test('high injects every fault kind only when fault visits are configured', () => {
  const config = make();
  const high = resolvePlan(config, 'high');
  assert.deepEqual(high.config.web.faultInjection, { ...config.web.faultInjection, kinds: FAULT_KINDS });
  assert.equal('kinds' in resolvePlan(config, 'medium').config.web.faultInjection, false);
  assert.equal(resolvePlan(make({ web: { faultInjection: false } }), 'high').config.web.faultInjection, null);
  assert.match(summarizePlan(high), /\+ fault visits \(500, delay, abort, 401, 403, 429, malformed\)/);
  assert.match(summarizePlan(resolvePlan(config, 'medium')), /sessions \+ fault visits ·/);
});


test('routine fault routes are explicit in the plan and high restores exhaustive route coverage', () => {
  const config = make({ web: { faultInjection: { routes: ['home'], concurrency: 8, terminalSelector: '#failed', minObservationMs: 1000 } } });
  assert.match(summarizePlan(resolvePlan(config, 'medium')), /fault routes: home/);
  const high = resolvePlan(config, 'high');
  assert.equal(high.config.web.faultInjection.routes, undefined);
  assert.equal(high.config.web.faultInjection.concurrency, 8);
  assert.equal(high.config.web.faultInjection.minObservationMs, 1000);
  assert.deepEqual(config.web.faultInjection.routes, ['home']);
  assert.doesNotMatch(summarizePlan(high), /fault routes:/);
});

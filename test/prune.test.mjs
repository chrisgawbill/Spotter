import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, symlink, utimes, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  retentionSettings, isActiveRun, pruneProject, lockedRetention, loadSavedRetention, saveRetention, directorySize, storageSummary,
} from '../src/prune.mjs';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const ago = (ms) => new Date(NOW - ms);
const HOUR = 3600_000;

async function tree() {
  const root = await mkdtemp(path.join(tmpdir(), 'spotter-prune-'));
  return { root, runs: path.join(root, 'runs'), baselines: path.join(root, 'baselines'), work: path.join(root, 'work') };
}
async function dir(parent, name, files = {}, age = 0) {
  const target = path.join(parent, name);
  await mkdir(target, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await writeFile(path.join(target, file), content);
    await utimes(path.join(target, file), ago(age), ago(age));
  }
  await utimes(target, ago(age), ago(age));
  return target;
}
const run = (d, name, activity, age = 0) => dir(d.runs, name, activity ? { 'activity.json': JSON.stringify(activity) } : {}, age);
const baseline = (d, name, age, withSide = true) => dir(d.baselines, name, withSide ? { 'side.json': '{}' } : {}, age);
const options = { keepRuns: 2, keepBaselines: 1, now: NOW };

test('retentionSettings applies defaults, env, overrides and validation', () => {
  assert.deepEqual(retentionSettings({}), { keepRuns: 10, keepBaselines: 5, autoPrune: true });
  const env = { SPOTTER_KEEP_RUNS: '3', SPOTTER_KEEP_BASELINES: '0', SPOTTER_AUTO_PRUNE: 'OFF' };
  assert.deepEqual(retentionSettings(env), { keepRuns: 3, keepBaselines: 0, autoPrune: false });
  assert.equal(retentionSettings(env, { keepRuns: '7' }).keepRuns, 7);
  assert.equal(retentionSettings(env, { keepBaselines: 4 }).keepBaselines, 4);
  assert.equal(retentionSettings({ SPOTTER_KEEP_RUNS: '' }).keepRuns, 10);
  for (const value of ['-1', 'abc', '1.5']) {
    assert.throws(() => retentionSettings({ SPOTTER_KEEP_RUNS: value }), /SPOTTER_KEEP_RUNS/);
    assert.throws(() => retentionSettings({ SPOTTER_KEEP_BASELINES: value }), /SPOTTER_KEEP_BASELINES/);
    assert.throws(() => retentionSettings({}, { keepRuns: value }), /--keep-runs/);
    assert.throws(() => retentionSettings({}, { keepBaselines: value }), /--keep-baselines/);
  }
  for (const value of ['false', '0']) assert.equal(retentionSettings({ SPOTTER_AUTO_PRUNE: value }).autoPrune, false);
  for (const value of ['on', 'TRUE', '1']) assert.equal(retentionSettings({ SPOTTER_AUTO_PRUNE: value }).autoPrune, true);
  assert.throws(() => retentionSettings({ SPOTTER_AUTO_PRUNE: 'maybe' }), /SPOTTER_AUTO_PRUNE must be on or off/);
});

test('isActiveRun needs a running status with a fresh heartbeat', () => {
  const at = (ms) => ago(ms).toISOString();
  assert.equal(isActiveRun({ status: 'running', updatedAt: at(5000) }, NOW), true);
  assert.equal(isActiveRun({ status: 'running', updatedAt: at(31_000) }, NOW), false);
  assert.equal(isActiveRun({ status: 'finished', updatedAt: at(1000) }, NOW), false);
  assert.equal(isActiveRun(null, NOW), false);
});

test('pruneProject trims runs, baselines and work while protecting live and latest runs', async () => {
  const d = await tree();
  const done = (days) => ({ status: 'done', startedAt: ago(days * 24 * HOUR).toISOString() });
  const newest = await run(d, 'r-new', done(1));
  const second = await run(d, 'r-second', done(2));
  const old = await run(d, 'r-old', done(5));
  const noActivity = await run(d, 'r-bare', null, 4 * 24 * HOUR);
  const pointed = await run(d, 'r-latest', done(30));
  await symlink('r-latest', path.join(d.runs, 'latest'));
  const keptBaseline = await baseline(d, 'b-new', HOUR);
  const oldBaseline = await baseline(d, 'b-old', 5 * HOUR);
  const noSide = await baseline(d, 'b-none', 0, false);
  const staleWork = await dir(d.work, 'x-1', { f: '1' }, 3 * HOUR);
  const staleRecord = await dir(d.work, 'record-old', { f: '1' }, 25 * HOUR);
  const freshRecord = await dir(d.work, 'record-new', { f: '1' }, HOUR);

  const dry = await pruneProject(d, { ...options, dryRun: true });
  assert.equal(dry.skipped, null);
  assert.ok(existsSync(old) && existsSync(noSide));

  const result = await pruneProject(d, options);
  assert.deepEqual(result.removed, dry.removed);
  assert.deepEqual(result.removed, [old, noActivity, oldBaseline, noSide, staleWork, staleRecord].sort());
  for (const kept of [newest, second, pointed, keptBaseline, freshRecord]) assert.ok(existsSync(kept), kept);
  for (const gone of result.removed) assert.ok(!existsSync(gone), gone);
});

test('pruneProject keeps an active run beyond the count and leaves baselines and work alone', async () => {
  const d = await tree();
  await run(d, 'r-1', { status: 'done', startedAt: ago(HOUR).toISOString() });
  await run(d, 'r-2', { status: 'done', startedAt: ago(2 * HOUR).toISOString() });
  const active = await run(d, 'r-live', { status: 'running', startedAt: ago(9 * HOUR).toISOString(), updatedAt: ago(1000).toISOString() });
  const oldBaseline = await baseline(d, 'b-old', 0, false);
  const work = await dir(d.work, 'x-1', { f: '1' });
  const result = await pruneProject(d, { ...options, keepRuns: 1 });
  assert.match(result.skipped, /run is in progress/);
  assert.equal(result.removed.length, 1);
  assert.ok(existsSync(active) && existsSync(oldBaseline) && existsSync(work));
});

test('pruneProject tolerates missing baselines and work folders', async () => {
  const d = await tree();
  assert.deepEqual(await pruneProject(d, options), { removed: [], skipped: null });
});

test('retentionSettings precedence is overrides, env, saved, defaults', () => {
  const saved = { keepRuns: 8, keepBaselines: 6, autoPrune: false };
  assert.deepEqual(retentionSettings({}, {}, saved), { keepRuns: 8, keepBaselines: 6, autoPrune: false });
  assert.deepEqual(retentionSettings({}, {}, { keepRuns: 0 }), { keepRuns: 0, keepBaselines: 5, autoPrune: true });
  const env = { SPOTTER_KEEP_RUNS: '3', SPOTTER_AUTO_PRUNE: 'on' };
  assert.deepEqual(retentionSettings(env, {}, saved), { keepRuns: 3, keepBaselines: 6, autoPrune: true });
  assert.equal(retentionSettings(env, { keepRuns: 1 }, saved).keepRuns, 1);
  assert.equal(retentionSettings({ SPOTTER_AUTO_PRUNE: '' }, {}, saved).autoPrune, false);
  assert.throws(() => retentionSettings({}, {}, { keepRuns: -1 }), /Saved keepRuns/);
  assert.throws(() => retentionSettings({}, {}, { keepBaselines: 1.5 }), /Saved keepBaselines/);
  assert.throws(() => retentionSettings({}, {}, { autoPrune: 'yes' }), /Saved autoPrune must be true or false/);
});

test('lockedRetention marks variables that are set and not empty', () => {
  assert.deepEqual(lockedRetention({}), { keepRuns: false, keepBaselines: false, autoPrune: false });
  assert.deepEqual(lockedRetention({ SPOTTER_KEEP_RUNS: '3', SPOTTER_KEEP_BASELINES: '', SPOTTER_AUTO_PRUNE: 'off' }),
    { keepRuns: true, keepBaselines: false, autoPrune: true });
});

test('saveRetention validates, creates the home folder and round-trips', async () => {
  const home = path.join((await tree()).root, 'nested', 'home');
  assert.deepEqual(await loadSavedRetention(home), {});
  const settings = { keepRuns: 4, keepBaselines: 0, autoPrune: false };
  assert.deepEqual(await saveRetention(home, settings), settings);
  assert.deepEqual(await loadSavedRetention(home), settings);
  for (const bad of [-1, 1.5, 'x']) {
    await assert.rejects(saveRetention(home, { ...settings, keepRuns: bad }), /keepRuns must be a whole number of 0 or more/);
    await assert.rejects(saveRetention(home, { ...settings, keepBaselines: bad }), /keepBaselines must be a whole number/);
  }
  await assert.rejects(saveRetention(home, { ...settings, autoPrune: 'on' }), /autoPrune must be true or false/);
  assert.deepEqual(await loadSavedRetention(home), settings);
  await writeFile(path.join(home, 'retention.json'), '{nope');
  assert.deepEqual(await loadSavedRetention(home), {});
  await writeFile(path.join(home, 'retention.json'), '[1]');
  assert.deepEqual(await loadSavedRetention(home), {});
});

test('directorySize sums nested files and treats a missing folder as empty', async () => {
  const d = await tree();
  await dir(d.runs, 'a', { f: '12345' });
  await dir(path.join(d.runs, 'a'), 'deep', { g: '123' });
  assert.equal(await directorySize(d.runs), 8);
  assert.equal(await directorySize(path.join(d.root, 'missing')), 0);
});

test('storageSummary reports counts, bytes and a cleanup preview without deleting', async () => {
  const d = await tree();
  const done = (hours) => ({ status: 'done', startedAt: ago(hours * HOUR).toISOString() });
  await run(d, 'r-new', done(1));
  await run(d, 'r-mid', done(2));
  const old = await run(d, 'r-old', done(3));
  await writeFile(path.join(old, 'big'), 'x'.repeat(100));
  await symlink('r-new', path.join(d.runs, 'latest'));
  await baseline(d, 'b-1', HOUR);
  const oldBaseline = await baseline(d, 'b-2', 5 * HOUR);
  const work = await dir(d.work, 'x-1', { f: '12345' }, 3 * HOUR);
  const summary = await storageSummary(d, options);
  assert.equal(summary.runs.count, 3);
  assert.equal(summary.baselines.count, 2);
  assert.equal(summary.work.count, 1);
  assert.equal(summary.runs.bytes, await directorySize(d.runs));
  assert.ok(summary.runs.bytes > 100);
  assert.equal(summary.work.bytes, 5);
  const dry = await pruneProject(d, { ...options, dryRun: true });
  const expected = (await Promise.all(dry.removed.map(directorySize))).reduce((a, b) => a + b, 0);
  assert.deepEqual(summary.cleanup, { count: dry.removed.length, bytes: expected, skipped: null });
  assert.equal(summary.cleanup.count, 3);
  assert.ok(existsSync(old) && existsSync(oldBaseline) && existsSync(work));
  assert.equal(await readFile(path.join(old, 'big'), 'utf8'), 'x'.repeat(100));
});

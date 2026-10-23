import { readdir, readFile, readlink, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_KEEP_RUNS = 10;
export const DEFAULT_KEEP_BASELINES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

function count(value, name, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a whole number of 0 or more`);
  return Number(value);
}

/** Retention counts: overrides (CLI flags) beat env, which beats defaults. */
export function retentionSettings(env = process.env, overrides = {}) {
  const keepRuns = overrides.keepRuns !== undefined && overrides.keepRuns !== ''
    ? count(overrides.keepRuns, '--keep-runs')
    : count(env.SPOTTER_KEEP_RUNS, 'SPOTTER_KEEP_RUNS', DEFAULT_KEEP_RUNS);
  const keepBaselines = overrides.keepBaselines !== undefined && overrides.keepBaselines !== ''
    ? count(overrides.keepBaselines, '--keep-baselines')
    : count(env.SPOTTER_KEEP_BASELINES, 'SPOTTER_KEEP_BASELINES', DEFAULT_KEEP_BASELINES);
  const auto = String(env.SPOTTER_AUTO_PRUNE ?? '').trim().toLowerCase();
  if (auto && !['on', 'true', '1', 'off', 'false', '0'].includes(auto)) throw new Error('SPOTTER_AUTO_PRUNE must be on or off');
  return { keepRuns, keepBaselines, autoPrune: !['off', 'false', '0'].includes(auto) };
}

/** True for a running activity whose heartbeat is under 30 seconds old. */
export function isActiveRun(activity, now = Date.now()) {
  return activity?.status === 'running' && now - Date.parse(activity.updatedAt) <= 30_000;
}

const entries = (directory, type) =>
  readdir(directory, { withFileTypes: true }).then(
    (found) => found.filter((entry) => (type ? entry[type]() : true)).map((entry) => entry.name),
    () => [],
  );
const mtime = (target) => stat(target).then((info) => info.mtimeMs, () => 0);
const newestFirst = (items) => items.sort((a, b) => b.time - a.time);

/** Deletes, or with dryRun only lists, old runs, baselines and work folders in one project's data folder. */
export async function pruneProject(directories, { keepRuns, keepBaselines, dryRun = false, now = Date.now() }) {
  const removed = [];

  const latest = await readlink(path.join(directories.runs, 'latest')).then((link) => path.basename(link), () => null);
  const runs = [];
  let active = false;
  for (const name of (await entries(directories.runs, 'isDirectory')).filter((entry) => entry !== 'latest')) {
    const directory = path.join(directories.runs, name);
    const activity = await readFile(path.join(directory, 'activity.json'), 'utf8').then(JSON.parse, () => null);
    const started = Date.parse(activity?.startedAt);
    const running = isActiveRun(activity, now);
    active ||= running;
    runs.push({ directory, name, keep: running || name === latest, time: Number.isNaN(started) ? await mtime(directory) : started });
  }
  newestFirst(runs).forEach((run, index) => {
    if (index >= keepRuns && !run.keep) removed.push(run.directory);
  });

  let skipped = null;
  if (active) {
    skipped = 'a run is in progress; baselines and work folders were left alone';
  } else {
    const baselines = [];
    for (const name of await entries(directories.baselines, 'isDirectory')) {
      const directory = path.join(directories.baselines, name);
      const time = await stat(path.join(directory, 'side.json')).then((info) => info.mtimeMs, () => null);
      if (time === null) removed.push(directory);
      else baselines.push({ directory, time });
    }
    removed.push(...newestFirst(baselines).slice(keepBaselines).map((baseline) => baseline.directory));
    for (const name of await entries(directories.work)) {
      const target = path.join(directories.work, name);
      if (name.startsWith('record-') && now - (await mtime(target)) <= DAY_MS) continue;
      removed.push(target);
    }
  }

  removed.sort();
  if (!dryRun) for (const target of removed) await rm(target, { recursive: true, force: true });
  return { removed, skipped };
}

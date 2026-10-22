import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Where Spotter keeps fixtures, baselines, runs and work dirs (inside the container: /data). */
export const spotterHome = process.env.SPOTTER_HOME ?? path.join(process.env.HOME ?? '/tmp', 'spotter');
const hostHome = process.env.SPOTTER_HOST_HOME ?? spotterHome;

/** Spotter's own install directory (holds projects/ configs). */
export const spotterRoot = path.resolve(new URL('..', import.meta.url).pathname);

/** Per-project data directories. */
export function projectDirs(projectName) {
  const root = path.join(spotterHome, projectName);
  return {
    root,
    fixtures: path.join(root, 'fixtures'),
    baselines: path.join(root, 'baselines'),
    runs: path.join(root, 'runs'),
    work: path.join(root, 'work'),
  };
}

/** Translates a container path under SPOTTER_HOME to the path the host user sees. */
export function toHostPath(containerPath) {
  return containerPath.startsWith(spotterHome) ? hostHome + containerPath.slice(spotterHome.length) : containerPath;
}

/** Hash of Spotter's own source, so cached baselines are dropped when Spotter changes. */
export function spotterCodeHash() {
  const hash = createHash('sha1');
  const sourceDir = path.join(spotterRoot, 'src');
  for (const file of readdirSync(sourceDir, { recursive: true }).filter((name) => name.endsWith('.mjs')).sort()) {
    hash.update(file).update(readFileSync(path.join(sourceDir, file)));
  }
  return hash.digest('hex').slice(0, 8);
}

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startBackend } from './backend.mjs';
import { loadProjectConfig } from './config.mjs';
import { exportCommit, resolveCommit } from './git.mjs';
import { projectDirs, spotterRoot } from './paths.mjs';

const defaultLog = (message) => process.stderr.write(`[spotter] ${message}\n`);

/** Runs `bin/spotter record <args>` (the container record), terminating it if this process exits. */
function recordInContainer(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(spotterRoot, 'bin/spotter'), ['record', ...args], { stdio: 'inherit' });
    const kill = () => child.kill('SIGTERM');
    process.once('exit', kill);
    child.once('error', (error) => { process.off('exit', kill); reject(error); });
    child.once('exit', (code) => { process.off('exit', kill); resolve(code ?? 1); });
  });
}

/**
 * `bin/spotter record <project> --host-backend …`: starts web.api.backend on this machine from an
 * export of the recorded ref, runs the container record against it, and stops it on every exit path.
 */
export async function hostRecord(argv, { loadConfig = loadProjectConfig, record = recordInContainer, log = defaultLog } = {}) {
  const [project, ...flags] = argv;
  if (!flags.includes('--host-backend')) throw new Error('Host backends need --host-backend');
  if (!project || project.startsWith('--')) throw new Error('Usage: spotter record <project> --host-backend [--ref <ref>] [--repo <path>] [--merge]');
  const config = await loadConfig(project, { includeSessions: false });
  const backend = config.web?.api?.backend;
  if (!backend) throw new Error(`--host-backend needs web.api.backend in projects/${project}.yml`);
  const flagValue = (name) => flags[flags.indexOf(name) + 1];
  const repo = flags.includes('--repo') ? path.resolve(flagValue('--repo')) : config.repo;
  const ref = flags.includes('--ref') ? flagValue('--ref') : config.baseBranch;
  const sha = await resolveCommit(repo, ref);
  const directories = projectDirs(project);
  const exportDir = path.join(directories.work, `record-host-${sha.slice(0, 12)}`);
  const logFile = path.join(directories.fixtures, 'logs', 'backend.log');
  await mkdir(path.dirname(logFile), { recursive: true });
  // Also on Ctrl-C/SIGTERM, where startBackend stops the backend and exits the process.
  const removeExport = () => rmSync(exportDir, { recursive: true, force: true });
  removeExport();
  process.once('exit', removeExport);
  try {
    await exportCommit(repo, sha, exportDir);
    log(`starting backend on this host in ${exportDir}: ${backend.run}`);
    if (backend.stop) log(`afterwards it will run: ${backend.stop}`);
    const started = await startBackend({ ...backend, cwd: exportDir, logFile })
      .catch((error) => { throw new Error(`${error.message}; see ${logFile}`); });
    try {
      return await record([project, ...flags.filter((flag) => flag !== '--host-backend'), '--backend-running']);
    } finally {
      await started.stop();
    }
  } finally {
    process.off('exit', removeExport);
    removeExport();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  hostRecord(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => { process.stderr.write(`spotter: ${error.message}\n`); process.exit(2); });
}

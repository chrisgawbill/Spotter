import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

process.env.SPOTTER_HOME = await mkdtemp(path.join(os.tmpdir(), 'spotter-home-'));
const { hostRecord } = await import('../src/host-record.mjs');

const hostRecordUrl = pathToFileURL(path.resolve('src/host-record.mjs')).href;
const tempDir = () => mkdtemp(path.join(os.tmpdir(), 'spotter-host-'));
const freePort = () => new Promise((resolve) => {
  const server = http.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function waitGone(pid) {
  for (let attempt = 0; attempt < 40 && isAlive(pid); attempt += 1) await sleep(50);
  return !isAlive(pid);
}
const readPid = async (dir) => Number((await readFile(path.join(dir, 'pid'), 'utf8')).trim());
const workDir = (project) => path.join(process.env.SPOTTER_HOME, project, 'work');
const exportsOf = async (project) => (await readdir(workDir(project)).catch(() => [])).filter((name) => name.startsWith('record-host-'));
// Runs in the export directory; the marker lands in the project's work directory.
const stopScript = 'kill -0 $(cat pid) 2>/dev/null && echo alive > ../stopped || echo gone > ../stopped';

/** A repo with one commit holding server.js; the backend runs from its export, one level below `dir`. */
async function fixture({ stop = stopScript } = {}) {
  const dir = await tempDir();
  const repo = path.join(dir, 'repo');
  const port = await freePort();
  await writeFile(path.join(dir, 'server.js'), `require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1');`);
  execFileSync('bash', ['-c', `mkdir ${repo} && cd ${repo} && git init -q -b main && cp ../server.js . && git add . && git -c user.name=t -c user.email=t@t commit -qm init`]);
  const backend = { run: 'sleep 300 & echo $! > pid; exec node server.js', readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 5000, stop };
  const loadConfig = async (name) => ({ name, repo, baseBranch: 'main', web: { api: { backend } } });
  return { dir, repo, port, backend, loadConfig };
}

test('hostRecord refuses without --host-backend and without a usable project', async () => {
  const { loadConfig } = await fixture();
  await assert.rejects(hostRecord(['demo', '--merge'], { loadConfig }), { message: 'Host backends need --host-backend' });
  await assert.rejects(hostRecord(['--ref', 'main', '--host-backend'], { loadConfig }), { message: 'Usage: spotter record <project> --host-backend [--ref <ref>] [--repo <path>] [--merge]' });
});

test('hostRecord refuses a config without a backend', async () => {
  await assert.rejects(
    hostRecord(['demo', '--host-backend'], { loadConfig: async () => ({ name: 'demo', web: { api: {} } }) }),
    { message: '--host-backend needs web.api.backend in projects/demo.yml' },
  );
});

test('hostRecord runs record against a live host backend, then stops it, runs the stop command and removes the export', async () => {
  const { port, loadConfig } = await fixture();
  let seen;
  const code = await hostRecord(['demo', '--merge', '--host-backend'], {
    loadConfig,
    log: () => {},
    record: async (args) => {
      seen = args;
      assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
      assert.equal((await exportsOf('demo')).length, 1);
      return 7;
    },
  });
  assert.equal(code, 7);
  assert.deepEqual(seen, ['demo', '--merge', '--backend-running']);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  assert.equal((await readFile(path.join(workDir('demo'), 'stopped'), 'utf8')).trim(), 'gone');
  assert.deepEqual(await exportsOf('demo'), []);
});

test('hostRecord reports a backend that fails to start with the log path and never records', async () => {
  const { repo, loadConfig } = await fixture();
  let recorded = false;
  const failing = async (name) => ({ ...(await loadConfig(name)), web: { api: { backend: { run: 'echo boom; exit 1', readyUrl: `http://127.0.0.1:${await freePort()}/`, timeoutMs: 5000 } } } });
  await assert.rejects(
    hostRecord(['failing', '--host-backend', '--repo', repo], { loadConfig: failing, log: () => {}, record: async () => { recorded = true; return 0; } }),
    (error) => /^backend exited with code 1 before http:\/\/127\.0\.0\.1:\d+\/ was ready; see .*failing\/fixtures\/logs\/backend\.log$/.test(error.message),
  );
  assert.equal(recorded, false);
});

test('SIGINT during record stops the backend group, runs the stop command and exits 130', async () => {
  const { dir, repo, backend } = await fixture();
  const helper = path.join(dir, 'helper.mjs');
  await writeFile(helper, `
    import { hostRecord } from ${JSON.stringify(hostRecordUrl)};
    const loadConfig = async (name) => ({ name, repo: ${JSON.stringify(repo)}, baseBranch: 'main', web: { api: { backend: ${JSON.stringify(backend)} } } });
    hostRecord(['sigint', '--host-backend'], { loadConfig, log: () => {}, record: () => { console.log('recording'); return new Promise(() => {}); } });
  `);
  const child = spawn(process.execPath, [helper], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  await new Promise((resolve) => child.stdout.on('data', (chunk) => String(chunk).includes('recording') && resolve()));
  const [exported] = await exportsOf('sigint');
  const sleeper = await readPid(path.join(workDir('sigint'), exported));
  assert.ok(isAlive(sleeper));
  child.kill('SIGINT');
  assert.equal(await exit, 130);
  assert.ok(await waitGone(sleeper));
  assert.equal((await readFile(path.join(workDir('sigint'), 'stopped'), 'utf8')).trim(), 'gone');
});

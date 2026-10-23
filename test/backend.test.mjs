import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { startBackend } from '../src/backend.mjs';

const backendUrl = pathToFileURL(path.resolve('src/backend.mjs')).href;
const tempDir = () => mkdtemp(path.join(os.tmpdir(), 'spotter-backend-'));
const freePort = () => new Promise((resolve) => {
  const server = http.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function waitGone(pid) {
  for (let attempt = 0; attempt < 40 && isAlive(pid); attempt += 1) await sleep(50);
  return !isAlive(pid);
}
/** A backend command: a background sleep (its pid goes to dir/pid) plus a server on `port` answering `status`. */
async function serverCommand(dir, port, status = 200) {
  const script = path.join(dir, 'server.js');
  await writeFile(script, `require('http').createServer((q, r) => { r.statusCode = ${status}; r.end('ok'); }).listen(${port}, '127.0.0.1');`);
  return `sleep 300 & echo $! > ${dir}/pid; exec node ${script}`;
}
const readPid = async (dir) => Number((await readFile(path.join(dir, 'pid'), 'utf8')).trim());

test('a ready backend is stopped with its whole process group and logs to the file', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const logFile = path.join(dir, 'backend.log');
  const backend = await startBackend({ run: await serverCommand(dir, port), readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 5000, cwd: dir, logFile });
  const sleeper = await readPid(dir);
  assert.ok(isAlive(sleeper));
  await backend.stop();
  assert.ok(await waitGone(sleeper));
  assert.ok(existsSync(logFile));
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});

test('stop twice is harmless', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const backend = await startBackend({ run: await serverCommand(dir, port), readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 5000, cwd: dir, logFile: path.join(dir, 'backend.log') });
  await backend.stop();
  await backend.stop();
});

test('a backend that exits before it is ready rejects with its exit code', async () => {
  const dir = await tempDir();
  const readyUrl = `http://127.0.0.1:${await freePort()}/`;
  await assert.rejects(
    startBackend({ run: 'echo boom; exit 1', readyUrl, timeoutMs: 5000, cwd: dir, logFile: path.join(dir, 'backend.log') }),
    { message: `backend exited with code 1 before ${readyUrl} was ready` },
  );
  assert.match(await readFile(path.join(dir, 'backend.log'), 'utf8'), /boom/);
});

test('a backend that never answers 200-399 rejects after the timeout and its group is gone', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const readyUrl = `http://127.0.0.1:${port}/`;
  await assert.rejects(
    startBackend({ run: await serverCommand(dir, port, 500), readyUrl, timeoutMs: 800, cwd: dir, logFile: path.join(dir, 'backend.log') }),
    { message: `backend not ready at ${readyUrl} after 0.8s` },
  );
  assert.ok(await waitGone(await readPid(dir)));
});

test('SIGTERM while running stops the backend group and exits 143', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const helper = path.join(dir, 'helper.mjs');
  await writeFile(helper, `
    import { startBackend } from ${JSON.stringify(backendUrl)};
    await startBackend({ run: ${JSON.stringify(await serverCommand(dir, port))}, readyUrl: 'http://127.0.0.1:${port}/', timeoutMs: 5000, cwd: ${JSON.stringify(dir)}, logFile: ${JSON.stringify(path.join(dir, 'backend.log'))} });
    console.log('ready');
    setInterval(() => {}, 1000);
  `);
  const child = spawn(process.execPath, [helper], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  await new Promise((resolve) => child.stdout.on('data', (chunk) => String(chunk).includes('ready') && resolve()));
  const sleeper = await readPid(dir);
  assert.ok(isAlive(sleeper));
  child.kill('SIGTERM');
  assert.equal(await exit, 143);
  assert.ok(await waitGone(sleeper));
});

const readStopped = async (dir) => (await readFile(path.join(dir, 'stopped'), 'utf8')).trim();

test('the stop command runs after the group is gone and is logged', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const logFile = path.join(dir, 'backend.log');
  const run = await serverCommand(dir, port);
  const backend = await startBackend({ run, readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 5000, stop: 'kill -0 $(cat pid) 2>/dev/null && echo alive > stopped || echo gone > stopped', cwd: dir, logFile });
  await backend.stop();
  assert.equal(await readStopped(dir), 'gone');
  assert.match(await readFile(logFile, 'utf8'), /\[spotter\] stop: kill -0/);
});

test('the stop command also runs on readiness timeout and on startup failure', async () => {
  const dir = await tempDir();
  const port = await freePort();
  await assert.rejects(startBackend({ run: await serverCommand(dir, port, 500), readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 800, stop: 'kill -0 $(cat pid) 2>/dev/null && echo alive > stopped || echo gone > stopped', cwd: dir, logFile: path.join(dir, 'backend.log') }));
  assert.equal(await readStopped(dir), 'gone');
  const failed = await tempDir();
  await assert.rejects(startBackend({ run: 'exit 1', readyUrl: `http://127.0.0.1:${await freePort()}/`, timeoutMs: 5000, stop: 'echo ran > stopped', cwd: failed, logFile: path.join(failed, 'backend.log') }));
  assert.equal(await readStopped(failed), 'ran');
});

test('a failing stop command does not throw and is reported', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const backend = await startBackend({ run: await serverCommand(dir, port), readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 5000, stop: 'exit 7', cwd: dir, logFile: path.join(dir, 'backend.log') });
  await backend.stop();
});

test('SIGTERM runs the stop command after the group is gone and exits 143', async () => {
  const dir = await tempDir();
  const port = await freePort();
  const helper = path.join(dir, 'helper.mjs');
  await writeFile(helper, `
    import { startBackend } from ${JSON.stringify(backendUrl)};
    await startBackend({ run: ${JSON.stringify(await serverCommand(dir, port))}, readyUrl: 'http://127.0.0.1:${port}/', timeoutMs: 5000, stop: 'kill -0 $(cat pid) 2>/dev/null && echo alive > stopped || echo gone > stopped', cwd: ${JSON.stringify(dir)}, logFile: ${JSON.stringify(path.join(dir, 'backend.log'))} });
    console.log('ready');
    setInterval(() => {}, 1000);
  `);
  const child = spawn(process.execPath, [helper], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  await new Promise((resolve) => child.stdout.on('data', (chunk) => String(chunk).includes('ready') && resolve()));
  child.kill('SIGTERM');
  assert.equal(await exit, 143);
  assert.equal(await readStopped(dir), 'gone');
});

// Run in the Spotter image: node --test integration/contracts.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spotterRoot } from '../src/paths.mjs';

const exec = promisify(execFile);

test('record CLI persists initial contracts, changed shape drift and unchanged shape refresh', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-contract-record-'));
  const project = `contract-record-${process.pid}`;
  const configFile = path.join(spotterRoot, 'projects', `${project}.yml`);
  let payload = { id: 1 };
  const api = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  try {
    const repo = path.join(dir, 'repo');
    await mkdir(path.join(repo, 'dist'), { recursive: true });
    await writeFile(path.join(repo, 'dist/index.html'), '<!doctype html><title>Contract record</title><main>Ready</main><script>fetch("http://api.spotter.test/data").then(r=>r.json()).then(data=>document.querySelector("main").textContent=JSON.stringify(data))</script>');
    for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Contract Test', '-c', 'user.email=contract@example.test', 'commit', '-m', 'Contract recording fixture']]) {
      await exec('git', args, { cwd: repo });
    }
    await writeFile(configFile, JSON.stringify({ repo, web: {
      build: { run: 'true' }, api: { envVar: 'API_URL', recordFrom: `http://127.0.0.1:${api.address().port}` },
      routes: ['/'], viewports: [375], colorSchemes: ['light'], settleMs: 100,
      sessions: [{ name: 'member', localStorage: { session: 'member' } }],
      accessibility: false, keyboard: false, faultInjection: false,
    } }));
    const home = path.join(dir, 'data');
    const record = () => exec(process.execPath, [path.join(spotterRoot, 'src/cli.mjs'), 'record', project], {
      env: { ...process.env, SPOTTER_HOME: home, SPOTTER_HOST_HOME: home }, timeout: 60000,
    });
    const read = async (name) => JSON.parse(await readFile(path.join(home, project, 'fixtures', name), 'utf8'));
    const first = await record();
    assert.match(first.stdout, /initial shape snapshot/);
    assert.deepEqual(await read('contract-drift.json'), []);
    const snapshot = await read('contracts.json');
    assert.deepEqual(snapshot.anonymous['GET /data'].shape, { object: { id: 'number' } });
    assert.deepEqual(snapshot.member['GET /data'].shape, snapshot.anonymous['GET /data'].shape);
    payload = { id: 'one', active: true };
    await record();
    const drift = await read('contract-drift.json');
    assert.deepEqual(drift.map(({ session, request, kind }) => ({ session, request, kind })), [
      { session: 'anonymous', request: 'GET /data', kind: 'changed' },
      { session: 'member', request: 'GET /data', kind: 'changed' },
    ]);
    assert.deepEqual((await read('contracts.json')).anonymous['GET /data'].shape, { object: { active: 'boolean', id: 'string' } });
    assert.deepEqual(JSON.parse((await read('api.json')).entries['GET /data'].body), payload);
    payload = { active: false, id: 'two' };
    const third = await record();
    assert.deepEqual(await read('contract-drift.json'), []);
    assert.match(third.stdout, /0 changed endpoint\/session contracts/);
  } finally {
    await new Promise((resolve) => api.close(resolve));
    await rm(configFile, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

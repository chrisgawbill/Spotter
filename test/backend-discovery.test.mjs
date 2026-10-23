import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverBackend } from '../src/backend-discovery.mjs';

async function repo(tree) {
  const dir = await mkdtemp(path.join(tmpdir(), 'spotter-backend-'));
  for (const [file, source] of Object.entries(tree)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), typeof source === 'string' ? source : JSON.stringify(source));
  }
  return { dir, files: Object.keys(tree), done: () => rm(dir, { recursive: true, force: true }) };
}
const options = { recordFrom: 'http://localhost:5000', name: 'shop', workdir: 'web' };
const web = '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>';
const launch = { profiles: { IIS: { commandName: 'IISExpress', applicationUrl: 'http://localhost:1' }, http: { commandName: 'Project', applicationUrl: 'https://localhost:5001;http://localhost:5000/', environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development', 'bad name': 'x', CONN: 'a b' } } } };
const dotnet = {
  'api/Api/Api.csproj': web,
  'api/Api/Properties/launchSettings.json': launch,
  'api/Api/Program.cs': 'app.MapHealthChecks("/health");',
  'api/compose.yaml': 'services:\n  db:\n    image: postgres:16\n',
  'api/.config/dotnet-tools.json': { tools: { 'dotnet-ef': { version: '8.0.0' } } },
  'api/Data/Data.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
  'api/Data/Migrations/001_Init.cs': 'class M {}',
};

test('a .NET web project with Compose and EF migrations gets a full proposal', async () => {
  const r = await repo(dotnet);
  try {
    const found = await discoverBackend(r.dir, r.files, options);
    assert.deepEqual(found.backend, {
      run: "docker compose -p spotter-shop -f api/compose.yaml up -d --wait && (cd api && dotnet tool restore && ASPNETCORE_ENVIRONMENT=Development dotnet ef database update --project Data --startup-project Api) && exec dotnet run --project api/Api --launch-profile http",
      readyUrl: 'http://localhost:5000/health', timeoutMs: 300000, stop: 'docker compose -p spotter-shop -f api/compose.yaml down -v' });
    assert.equal(found.evidence, 'backend inferred from api/Api/Api.csproj with health route /health, Compose services db from api/compose.yaml, EF migrations via api/.config/dotnet-tools.json; review the command before recording');
    assert.deepEqual(found.notes, ['The proposed web.api.backend needs .NET SDK and Docker Compose on this server; record with bin/spotter record shop --host-backend.', 'No seed or reset script found for the backend; recordings will reflect an empty database unless the backend seeds itself.']);
  } finally { await r.done(); }
});

test('a .NET project without a health route uses its app URL and non-Web SDK projects are ignored', async () => {
  const r = await repo({ 'Api.csproj': web, 'Properties/launchSettings.json': launch, 'Lib/Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>', 'Lib/Properties/launchSettings.json': launch });
  try {
    const found = await discoverBackend(r.dir, r.files, options);
    assert.equal(found.backend.readyUrl, 'http://localhost:5000');
    assert.equal(found.backend.run, 'exec dotnet run --project . --launch-profile http');
    assert.match(found.evidence, /^backend inferred from Api\.csproj; review/);
    assert.deepEqual(found.notes.length, 2);
  } finally { await r.done(); }
});

const node = {
  'server/package.json': { scripts: { start: 'node index.js', seed: 'node seed.js' }, dependencies: { express: '*' } },
  'server/package-lock.json': '{}',
  'server/index.js': "app.get('/health', ok); app.listen(4020);",
  'web/package.json': { scripts: { dev: 'vite' }, dependencies: { express: '*' } },
};

test('a Node backend runs install, its own seed script and start from its folder', async () => {
  const r = await repo(node);
  try {
    const found = await discoverBackend(r.dir, r.files, { ...options, recordFrom: 'http://127.0.0.1:4020' });
    assert.deepEqual(found.backend, { run: 'cd server && npm ci && npm run seed && exec npm run start', readyUrl: 'http://localhost:4020/health', timeoutMs: 300000 });
    assert.equal(found.evidence, 'backend inferred from server/package.json with health route /health, seed script server/package.json seed; review the command before recording');
    assert.deepEqual(found.notes, []);
  } finally { await r.done(); }
});

test('a Node backend takes a seed script from another package under the Compose folder', async () => {
  const r = await repo({ ...node, 'server/package.json': { scripts: { start: 'node index.js' }, dependencies: { fastify: '*' } }, 'compose.yml': 'services:\n  db:\n    image: redis\n', 'tools/package.json': { scripts: { 'db:reset': 'x' } }, 'tools/yarn.lock': '' });
  try {
    const found = await discoverBackend(r.dir, r.files, { ...options, recordFrom: 'http://localhost:4020' });
    assert.equal(found.backend.run, "docker compose -p spotter-shop -f compose.yml up -d --wait && cd server && npm ci && (cd ../tools && yarn install --frozen-lockfile && yarn run db:reset) && exec npm run start");
    assert.match(found.notes.join(' '), /needs Docker Compose on this server/);
  } finally { await r.done(); }
});

test('a Compose file with a build service is not attached and adds a note', async () => {
  const r = await repo({ ...node, 'compose.yaml': 'services:\n  app:\n    build: .\n' });
  try {
    const found = await discoverBackend(r.dir, r.files, { ...options, recordFrom: 'http://localhost:4020' });
    assert.equal(found.backend.stop, undefined);
    assert.ok(!found.backend.run.includes('docker'));
    assert.deepEqual(found.notes, ['compose.yaml builds services; review whether the backend needs it.']);
  } finally { await r.done(); }
});

test('no matching, several matching or no recordFrom produce a note and no backend', async () => {
  const r = await repo({ ...node, 'other/package.json': { scripts: { start: 'x' }, dependencies: { koa: '*' } }, 'other/main.js': 'app.listen(4020)' });
  try {
    const labels = 'server/package.json (Node express), other/package.json (Node koa)';
    assert.deepEqual(await discoverBackend(r.dir, r.files, { ...options, recordFrom: 'http://localhost:9' }), { backend: null, evidence: null, notes: [`Backend candidates found (${labels}) but none serves http://localhost:9; configure web.api.backend manually.`] });
    const several = await discoverBackend(r.dir, r.files, { ...options, recordFrom: 'http://localhost:4020' });
    assert.equal(several.backend, null);
    assert.match(several.notes[0], /^Several backends serve http:\/\/localhost:4020 \(/);
    const none = await discoverBackend(r.dir, r.files, { ...options, recordFrom: undefined });
    assert.match(none.notes[0], /set web\.api\.recordFrom to choose one\.$/);
    assert.deepEqual(await discoverBackend(r.dir, ['x.txt'], options), { backend: null, evidence: null, notes: [] });
  } finally { await r.done(); }
});

test('the missing seed note is present only without a seed script', async () => {
  const withSeed = await repo(node);
  const without = await repo({ ...node, 'server/package.json': { scripts: { start: 'x' }, dependencies: { express: '*' } } });
  try {
    const opts = { ...options, recordFrom: 'http://localhost:4020' };
    assert.equal((await discoverBackend(withSeed.dir, withSeed.files, opts)).notes.length, 0);
    assert.match((await discoverBackend(without.dir, without.files, opts)).notes[0], /^No seed or reset script found/);
  } finally { await withSeed.done(); await without.done(); }
});

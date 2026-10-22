import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sessionStorageState, readSessionState } from '../src/sessions.mjs';
import { normalizeConfig } from '../src/config.mjs';

test('saved cookies and localStorage remap only the selected origin; overrides win', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-session-'));
  const file = path.join(dir, 'state.json');
  try {
    await writeFile(file, JSON.stringify({ cookies: [{ name: 'session', value: 'secret', domain: '.app.test', path: '/' }, { name: 'other', value: 'other', domain: 'provider.test', path: '/' }], origins: [{ origin: 'https://app.test', localStorage: [{ name: 'token', value: 'secret' }, { name: 'theme', value: 'saved' }] }, { origin: 'https://provider.test', localStorage: [] }] }));
    const state = await sessionStorageState({ name: 'member', storageState: file, storageOrigin: 'https://app.test', localStorage: { token: 'override' } }, 'http://127.0.0.1:1234', { theme: 'dark' });
    assert.deepEqual(state.cookies.map((cookie) => cookie.domain), ['127.0.0.1', 'provider.test']);
    assert.deepEqual(state.origins[0], { origin: 'http://127.0.0.1:1234', localStorage: [{ name: 'token', value: 'override' }, { name: 'theme', value: 'dark' }] });
    await writeFile(file, 'secret invalid JSON');
    await assert.rejects(readSessionState({ name: 'member', storageState: file }), (error) => !error.message.includes('secret') && error.message.includes('member'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('auth config rejects ambiguous state paths, invalid origins and live config', () => {
  const config = (web) => normalizeConfig({ repo: '/tmp/app', web: { build: { run: 'true' }, routes: ['/'], ...web } }, { projectName: 'auth' });
  assert.doesNotThrow(() => config({ sessions: [{ name: 'member', storageState: '/run/spotter-auth/member.json', storageOrigin: 'https://app.test' }] }));
  for (const session of [{ name: 'member', storageState: 'relative.json' }, { name: 'member', storageState: '/tmp/state', storageOrigin: 'https://app.test/path' }]) assert.throws(() => config({ sessions: [session] }), /sessions/);
  for (const live of [{}, { files: ['../escape'], baseURL: 'https://app.test', env: [] }, { files: ['live.mjs'], baseURL: 'file:///tmp', env: [] }, { files: ['live.mjs'], baseURL: 'https://app.test', env: ['BAD-NAME'] }]) assert.throws(() => config({ specs: { files: ['auth.spec.mjs'], live } }), /live/);
});

test('private state changes invalidate cached baselines; live mode does not require state files', async () => {
  const { loadProjectConfig } = await import('../src/config.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spotter-state-hash-'));
  const projectName = `qa07-test-${path.basename(dir)}`;
  const configFile = new URL(`../projects/${projectName}.yml`, import.meta.url);
  const stateFile = path.join(dir, 'member.json');
  try {
    await mkdir(new URL('../projects/', import.meta.url), { recursive: true });
    await writeFile(configFile, JSON.stringify({ repo: dir, web: { build: { run: 'true' }, routes: ['/'], sessions: [{ name: 'member', storageState: stateFile }] } }));
    await writeFile(stateFile, JSON.stringify({ cookies: [], origins: [] }));
    const before = await loadProjectConfig(projectName);
    await writeFile(stateFile, JSON.stringify({ cookies: [], origins: [{ origin: 'https://app.test', localStorage: [{ name: 'token', value: 'changed-private-token' }] }] }));
    const after = await loadProjectConfig(projectName);
    assert.notEqual(before.configHash, after.configHash);
    assert(!JSON.stringify(after).includes('changed-private-token'));
    await rm(stateFile);
    await assert.rejects(loadProjectConfig(projectName), /cannot read storageState/);
    await assert.doesNotReject(loadProjectConfig(projectName, { includeSessions: false }));
  } finally { await rm(configFile, { force: true }); await rm(dir, { recursive: true, force: true }); }
});

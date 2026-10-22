import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSpecsStage } from '../src/stages/specs.mjs';
import { startStaticServer } from '../src/staticServer.mjs';
import { compareWithBaseline } from '../src/findings.mjs';
import { normalizeConfig } from '../src/config.mjs';
import { runWebStage } from '../src/stages/web.mjs';
import { parseArguments } from '../src/cli.mjs';

test('generic form and OAuth flows; private state isolation, live selection and seeded failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-auth-'));
  let server;
  try {
    await cp(new URL('../examples/authentication', import.meta.url), root, { recursive: true });
    await mkdir(path.join(root, 'logs'));
    server = await startStaticServer(root, '/');
    const stateFile = path.join(root, 'member.json');
    await writeFile(stateFile, JSON.stringify({ cookies: [{ name: 'session', value: 'example-member', domain: 'app.test', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [{ origin: 'https://app.test', localStorage: [{ name: 'private', value: 'private-session-value' }] }] }));
    const config = { web: { base: '/', specs: { files: ['auth.spec.mjs', 'state.spec.mjs'] }, sessions: [{ name: 'anonymous', localStorage: {} }, { name: 'member', storageState: stateFile, storageOrigin: 'https://app.test' }] } };
    await writeFile(path.join(root, 'state.spec.mjs'), `
      const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);
      test('State Verify: anonymous isolation', async ({ page, context }) => {
        await page.goto('./');
        expect(await context.cookies()).toEqual([]);
        expect(await page.evaluate(() => localStorage.getItem('private'))).toBeNull();
      });
      test.describe('member', () => {
        test.use({ spotterSession: 'member' });
        test('State Verify: native state seeds once', async ({ page, context }) => {
          await page.goto('./');
          expect((await context.cookies()).some(c => c.name === 'session')).toBe(true);
          expect(await page.evaluate(() => localStorage.getItem('private'))).toBe('private-session-value');
          await context.clearCookies();
          await page.evaluate(() => localStorage.clear());
          await page.reload();
          expect(await context.cookies()).toEqual([]);
          expect(await page.evaluate(() => localStorage.getItem('private'))).toBeNull();
        });
      });
    `);
    const run = (name) => runSpecsStage({ config, workdir: root, logDir: path.join(root, 'logs', name), fixtures: null, appOrigin: server.origin });
    const healthy = await run('healthy');
    assert.equal(healthy.summary.passed, 7, JSON.stringify(healthy));
    assert.deepEqual(healthy.findings, []);
    const htmlFile = path.join(root, 'index.html');
    const html = await readFile(htmlFile, 'utf8');
    await writeFile(htmlFile, html.replace("pending?.state === query.get('state')", 'pending !== null'));
    const broken = await run('seeded');
    const comparison = compareWithBaseline(broken.findings, healthy.findings);
    assert.equal(comparison.newFindings.length, 1, JSON.stringify(broken));
    assert.match(comparison.newFindings[0].title, /mismatched-state/);
    await writeFile(htmlFile, html);
    await writeFile(path.join(root, 'redact.spec.mjs'), `
      const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);
      test('State Verify: redaction', async () => { console.log('private-session-value'); expect('private-session-value').toBe('wrong'); });
    `);
    config.web.specs.files = ['redact.spec.mjs'];
    const redacted = await run('redacted');
    assert(!JSON.stringify(redacted).includes('private-session-value'));
    for (const file of ['run.log', 'results.json']) assert(!(await readFile(path.join(root, 'logs/redacted/specs', file), 'utf8')).includes('private-session-value'));
    config.web.specs = { files: ['auth.spec.mjs'], mode: 'live', workers: 2, live: { files: ['live.spec.mjs'], env: ['SPOTTER_EXAMPLE_PASSWORD'], baseURL: server.origin + '/' } };
    await assert.rejects(run('missing-live'), /requires environment variable SPOTTER_EXAMPLE_PASSWORD/);
    process.env.SPOTTER_EXAMPLE_PASSWORD = 'private-live-password';
    await writeFile(path.join(root, 'live.spec.mjs'), `
      const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);
      test('Live Verify: selected credentials and real clock', async ({ page, spotterLive, spotterCredentials }, testInfo) => {
        expect(testInfo.config.workers).toBe(1);
        expect(spotterLive).toBe(true);
        expect(spotterCredentials.SPOTTER_EXAMPLE_PASSWORD).toBe('private-live-password');
        await page.goto('./');
        expect(await page.evaluate(() => Date.now())).toBeGreaterThan(Date.parse('2026-01-01'));
      });
      test('Live Verify: failure output privacy', async () => { console.log('private-live-password'); throw new Error('dynamic-oauth-code'); });
    `);
    const live = await run('live');
    assert.equal(live.summary.mode, 'live');
    assert.equal(live.summary.passed, 1, JSON.stringify(live));
    assert.equal(live.findings.length, 1, JSON.stringify(live));
    assert(!JSON.stringify(live).includes('dynamic-oauth-code'));
    assert(!(await readFile(path.join(root, 'logs/live/specs/run.log'), 'utf8')).includes('private-live-password'));
    config.web.specs.mode = undefined;
    config.web.specs.files = ['routine.spec.mjs'];
    await writeFile(path.join(root, 'routine.spec.mjs'), `
      const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);
      test('Routine Verify: live credentials unavailable', async ({ spotterLive, spotterCredentials }) => {
        expect(spotterLive).toBe(false);
        expect(spotterCredentials).toEqual({});
        expect(process.env.SPOTTER_EXAMPLE_PASSWORD).toBeUndefined();
      });
    `);
    assert.equal((await run('routine')).summary.passed, 1);
    assert.equal(parseArguments(['run', 'app', '--live-auth']).liveAuth, true);
    delete process.env.SPOTTER_EXAMPLE_PASSWORD;
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
});


test('saved state reaches the automatic sweep without exposing private values in screenshots or findings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-auth-sweep-'));
  try {
    await mkdir(path.join(root, 'dist'));
    await mkdir(path.join(root, 'logs'));
    const state = path.join(root, 'member.json');
    await writeFile(state, JSON.stringify({ cookies: [{ name: 'session', value: 'private-cookie-value', domain: 'app.test', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [{ origin: 'https://app.test', localStorage: [{ name: 'private', value: 'private-storage-value' }] }] }));
    await writeFile(path.join(root, 'dist/index.html'), `<h1>Account</h1><script>
      const value = localStorage.getItem('private');
      if (value) {
        if (document.cookie !== 'session=private-cookie-value') throw Error('cookie not seeded');
        console.error(value);
      } else if (document.cookie) throw Error('anonymous cookies not isolated');
    </script>`);
    const config = normalizeConfig({ repo: root, web: { build: { run: 'true' }, routes: [{ name: 'home', path: '/' }], viewports: [375], colorSchemes: ['light'], settleMs: 0, keyboard: false, accessibility: false, faultInjection: false, sessions: [{ name: 'member', storageState: state, storageOrigin: 'https://app.test' }] } }, { projectName: 'auth-sweep' });
    const result = await runWebStage({ config, workdir: root, logDir: path.join(root, 'logs'), screenshotDir: path.join(root, 'screenshots') });
    assert.equal(result.summary.pages, 2);
    assert.equal(result.findings.length, 1, JSON.stringify(result));
    assert.equal(result.findings[0].check, 'console-error');
    assert.match(result.findings[0].title, /redacted/);
    assert.deepEqual(result.findings[0].artifacts, []);
    assert(!(JSON.stringify(result).includes('private-storage-value')));
    assert.deepEqual(await readdir(path.join(root, 'screenshots')), ['home-375-light-anonymous.png']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

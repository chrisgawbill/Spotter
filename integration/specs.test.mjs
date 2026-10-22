import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSpecsStage } from '../src/stages/specs.mjs';
import { startStaticServer } from '../src/staticServer.mjs';

test('project specs share replay, clock, sessions and theme; failures use normal findings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spotter-specs-'));
  let server;
  try {
    await mkdir(path.join(root, 'dist'));
    await mkdir(path.join(root, 'logs'));
    await writeFile(path.join(root, 'dist/index.html'), '<h1>Spec app</h1>');
    await writeFile(path.join(root, 'verify.spec.mjs'), `
      const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);
      test.use({ spotterSession: 'member', colorScheme: 'dark' });
      test('TICKET Verify 1: deterministic signed-in state', async ({ page }) => {
        await page.goto('./');
        expect(await page.evaluate(() => new Date().toISOString())).toBe('2026-01-02T00:00:00.000Z');
        expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
        expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('member');
        expect(await page.evaluate(async () => (await fetch('https://fixture.invalid/data')).text())).toBe('member');
      });
      test('TICKET Verify 2: seeded failure', async ({ page }) => {
        await page.goto('./');
        await expect(page.locator('h1')).toHaveText('Wrong', { timeout: 50 });
      });
      test('TICKET Verify 3: missing fixture', async ({ page }) => {
        await page.goto('./');
        await page.evaluate(() => fetch('https://fixture.invalid/missing'));
      });
    `);
    server = await startStaticServer(path.join(root, 'dist'), '/');
    const config = { web: {
      base: '/', specs: { files: ['verify.spec.mjs'] }, api: { fakeOrigin: 'https://fixture.invalid' },
      sessions: [{ name: 'anonymous', localStorage: {} }, { name: 'member', localStorage: { token: 'member' } }],
      colorSchemeStorage: { dark: { theme: 'dark' } },
    } };
    const fixtures = { recordedAt: '2026-01-02T00:00:00.000Z', entries: { 'GET /data': { status: 200, body: 'anonymous' } }, sessions: { member: { 'GET /data': { status: 200, body: 'member' } } } };
    const result = await runSpecsStage({ config, workdir: root, logDir: path.join(root, 'logs'), fixtures, appOrigin: server.origin });
    assert.equal(result.summary.passed, 1, JSON.stringify(result));
    assert.equal(result.findings.length, 2, JSON.stringify(result));
    assert(result.findings.every((finding) => finding.check === 'project-spec' && finding.severity === 'high'));
    assert(result.findings.some((finding) => finding.title.includes('Verify 2')));
    assert(result.findings.some((finding) => finding.title.includes('Verify 3') && finding.detail.includes('missing')));
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

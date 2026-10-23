import { readFile } from 'node:fs/promises';
import { test as base, expect } from 'playwright/test';
import { replayFixtures } from '../fixtures.mjs';
import { sessionStorageState } from '../sessions.mjs';

const settings = JSON.parse(await readFile(process.env.SPOTTER_SPEC_SETTINGS, 'utf8'));

/** Project specs import this module through SPOTTER_TEST_MODULE. */
export const test = base.extend({
  spotterSession: ['anonymous', { option: true }],
  spotterLive: [settings.web.specs?.mode === 'live', { option: true }],
  spotterCredentials: async ({ spotterLive }, use) => {
    await use(spotterLive ? Object.fromEntries(settings.web.specs.live.env.map((name) => [name, process.env[name]])) : {});
  },
  storageState: async ({ spotterSession, colorScheme, spotterLive }, use) => {
    const session = settings.web.sessions.find((item) => item.name === spotterSession);
    if (!session) throw new Error(`Unknown Spotter session: ${spotterSession}`);
    await use(spotterLive ? { cookies: [], origins: [] } : await sessionStorageState(session, settings.appOrigin, settings.web.colorSchemeStorage?.[colorScheme]));
  },
  _spotter: [async ({ context, spotterLive, spotterSession }, use) => {
    if (!spotterLive && settings.fixtures?.recordedAt) await context.clock.setFixedTime(new Date(settings.fixtures.recordedAt));
    const missing = [];
    if (!spotterLive && settings.web.api) await replayFixtures(context, {
      fakeOrigin: settings.web.api.fakeOrigin, apiPaths: settings.web.api.paths ?? [], appOrigin: settings.appOrigin,
      fixtures: spotterSession === 'anonymous' ? settings.fixtures : { ...settings.fixtures, entries: settings.fixtures?.sessions?.[spotterSession] ?? {} },
      onUnrecorded: (key) => missing.push(key),
    });
    await use();
    expect(missing, 'API requests missing from Spotter fixtures').toEqual([]);
  }, { auto: true }],
});
export { expect };

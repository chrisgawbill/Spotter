import { readFile } from 'node:fs/promises';
import { test as base, expect } from 'playwright/test';
import { replayFixtures } from '../fixtures.mjs';

const settings = JSON.parse(await readFile(process.env.SPOTTER_SPEC_SETTINGS, 'utf8'));

/** Project specs import this module through SPOTTER_TEST_MODULE. */
export const test = base.extend({
  spotterSession: ['anonymous', { option: true }],
  _spotter: [async ({ context, spotterSession, colorScheme }, use) => {
    const session = settings.web.sessions.find((item) => item.name === spotterSession);
    if (!session) throw new Error(`Unknown Spotter session: ${spotterSession}`);
    if (settings.fixtures?.recordedAt) await context.clock.setFixedTime(new Date(settings.fixtures.recordedAt));
    await context.addInitScript(({ entries, origin }) => {
      if (location.origin === origin) for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, { entries: { ...session.localStorage, ...settings.web.colorSchemeStorage?.[colorScheme] }, origin: settings.appOrigin });
    const missing = [];
    if (settings.web.api) await replayFixtures(context, {
      fakeOrigin: settings.web.api.fakeOrigin, appOrigin: settings.appOrigin,
      fixtures: spotterSession === 'anonymous' ? settings.fixtures : { ...settings.fixtures, entries: settings.fixtures?.sessions?.[spotterSession] ?? {} },
      onUnrecorded: (key) => missing.push(key),
    });
    await use();
    expect(missing, 'API requests missing from Spotter fixtures').toEqual([]);
  }, { auto: true }],
});
export { expect };

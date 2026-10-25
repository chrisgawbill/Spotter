import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeFault } from '../src/stages/web.mjs';

test('early fault completion respects budgets, stable terminal states, injection and pending work', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const fault = { key: 'GET /data', kind: '500', timeoutMs: 3000, minObservationMs: 800, terminalSelector: '#failed', loadingSelector: '#loading' };
  async function observe({ override = {}, healthy = {}, injected = true, quiet = true, visible = () => true, loading = false } = {}) {
    t.mock.timers.setTime(0);
    const page = {
      waitForTimeout: async (ms) => t.mock.timers.tick(ms),
      locator: (selector) => ({ evaluateAll: async () => selector === '#loading' ? loading : visible(Date.now()) }),
    };
    const early = await observeFault(page, { fault: { ...fault, ...override }, healthy, requests: new Set(injected ? [fault.key] : []), network: { isQuiet: () => quiet } });
    return { early, elapsed: Date.now() };
  }
  assert.deepEqual(await observe(), { early: true, elapsed: 1300 });
  // A transient error during a retry must reset the stability window.
  assert.deepEqual(await observe({ visible: (ms) => ms < 1100 || ms >= 1800 }), { early: true, elapsed: 2300 });
  for (const options of [{ override: { kind: 'delay' } }, { override: { terminalSelector: undefined } }, { healthy: { terminalPresent: true } }, { injected: false }, { quiet: false }, { visible: () => false }, { loading: true }]) {
    assert.deepEqual(await observe(options), { early: false, elapsed: 3000 });
  }
});

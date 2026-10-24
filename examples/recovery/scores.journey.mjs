const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

// The retry window: Retry-After seconds plus time for the timer, the request and rendering.
const RETRY_AFTER_S = 1;
const RETRY_BUDGET_MS = RETRY_AFTER_S * 1000 + 3000;

const SCORES = { 2026: ['Alpha', 'Bravo'], 2025: ['Old Alpha', 'Old Bravo'] };
let api;
let pageErrors;

// Routing lives in the spec because the project owns its payloads and failure modes.
// Each test sets `api.answer` (next answer for GET api/scores) and `api.signIn` (POST api/session).
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  api = {
    scoresRequests: 0,
    sessionRequests: 0,
    offline: false,
    answer: async (season) => ({ json: { season, scores: SCORES[season].map((name) => ({ name })) } }),
    signIn: async () => ({ status: 204 }),
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/session')) {
      api.sessionRequests += 1;
      return route.fulfill(await api.signIn());
    }
    api.scoresRequests += 1;
    if (api.offline) return route.abort('internetdisconnected');
    return route.fulfill(await api.answer(url.searchParams.get('season')));
  });
});

// Handled, injected failures must add nothing; an unhandled one fails the test it happened in.
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

// Answers the first request with `first`, then falls back to the healthy answer.
const failOnce = (first) => {
  const healthy = api.answer;
  api.answer = async () => {
    api.answer = healthy;
    return first;
  };
};

const alert = (page) => page.getByRole('alert');
const items = (page) => page.getByRole('listitem');
const refresh = (page) => page.getByRole('button', { name: 'Refresh' });
const retry = (page) => page.getByRole('button', { name: 'Retry' });

test('Recovery Verify: a dropped connection shows offline, then reloads on reconnect @critical', async ({ page, context }) => {
  await page.goto('./');
  await expect(items(page)).toHaveText(['Alpha', 'Bravo']);
  api.offline = true;
  await context.setOffline(true);
  await refresh(page).click();
  await expect(alert(page)).toContainText('You are offline. Scores reload when the connection returns.');
  await expect(refresh(page)).toBeEnabled();
  api.offline = false;
  await context.setOffline(false);
  await expect(items(page)).toHaveText(['Alpha', 'Bravo']);
  await expect(alert(page)).toHaveCount(0);
});

test('Recovery Verify: an expired session asks to sign in and recovers', async ({ page }) => {
  failOnce({ status: 401, body: '' });
  await page.goto('./');
  await expect(alert(page)).toContainText('Your session has expired. Sign in again.');
  await expect(retry(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(items(page)).toHaveText(['Alpha', 'Bravo']);
  await expect(alert(page)).toHaveCount(0);
  expect(api.sessionRequests).toBe(1);
});

test('Recovery Verify: a forbidden response explains itself without a useless retry', async ({ page }) => {
  failOnce({ status: 403, body: '' });
  await page.goto('./');
  await expect(alert(page)).toHaveText('You do not have access to these scores.');
  await expect(retry(page)).toHaveCount(0);
  await expect(refresh(page)).toBeEnabled();
});

test('Recovery Verify: a rate-limited load waits for Retry-After, then succeeds', async ({ page }) => {
  failOnce({ status: 429, headers: { 'retry-after': String(RETRY_AFTER_S) }, body: '' });
  await page.goto('./');
  await expect(alert(page)).toHaveText(`Too many requests. Retrying in ${RETRY_AFTER_S} s.`);
  await expect(items(page)).toHaveText(['Alpha', 'Bravo'], { timeout: RETRY_BUDGET_MS });
  expect(api.scoresRequests).toBe(2);
});

test('Recovery Verify: a malformed response shows an error and Retry recovers @critical', async ({ page }) => {
  failOnce({ status: 200, contentType: 'application/json', body: '{"scores": [' });
  await page.goto('./');
  await expect(alert(page)).toContainText('The server sent an unreadable response.');
  await expect(refresh(page)).toBeEnabled();
  await expect(page.getByRole('list')).not.toHaveAttribute('aria-busy', 'true');
  await retry(page).click();
  await expect(items(page)).toHaveText(['Alpha', 'Bravo']);
  await expect(alert(page)).toHaveCount(0);
});

test('Recovery Verify: a stale response never overwrites a newer one @critical', async ({ page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const healthy = api.answer;
  api.answer = (season) => (season === '2026' ? held.then(() => healthy(season)) : healthy(season));
  await page.goto('./');
  await page.getByLabel('Season').selectOption('2025');
  await expect(items(page)).toHaveText(['Old Alpha', 'Old Bravo']);
  const finished = page.waitForEvent('requestfinished', (request) => request.url().includes('season=2026'));
  release();
  await finished;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(items(page)).toHaveText(['Old Alpha', 'Old Bravo']);
});

test('Recovery Verify: a server error offers Retry and Retry recovers', async ({ page }) => {
  failOnce({ status: 500, body: '' });
  await page.goto('./');
  await expect(alert(page)).toContainText('Scores could not load (500).');
  await retry(page).click();
  await expect(items(page)).toHaveText(['Alpha', 'Bravo']);
});

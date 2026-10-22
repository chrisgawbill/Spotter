import { createHash } from 'node:crypto';
const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

// These routes simulate this example project's server. Real projects assert their own contract.
test.beforeEach(async ({ context }) => {
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const signedIn = (request.headers().cookie ?? '').includes('session=example-member');
    if (pathname === '/api/me') return route.fulfill({ status: signedIn ? 200 : 401, json: {} });
    if (pathname === '/api/logout') return route.fulfill({ headers: { 'set-cookie': 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' }, json: {} });
    if (pathname === '/api/login') {
      const body = request.postDataJSON();
      expect(body.email).toBe('member@example.test');
      if (body.password !== 'example-password') return route.fulfill({ status: 401, json: {} });
    }
    return route.fulfill({ headers: { 'set-cookie': 'session=example-member; Path=/; HttpOnly; SameSite=Lax' }, json: {} });
  });
});

test('Form Verify: cookie login, restoration, expiry and sign-out', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Signed out');
  await page.getByLabel('Email').fill('member@example.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Sign-in rejected');
  await page.getByLabel('Password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Signed in');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Signed in');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Signed out');
  await context.addCookies([{ name: 'session', value: 'expired', url: page.url() }]);
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Signed out');
});

for (const outcome of ['success', 'cancel', 'mismatched-state', 'rejected']) {
  test(`OAuth Verify: ${outcome}, PKCE and callback cleanup`, async ({ page, context }) => {
    let exchangeCount = 0;
    let pending;
    let capture;
    const pendingReady = new Promise(resolve => { capture = resolve; });
    await context.exposeBinding('capturePending', (_, raw) => { pending = JSON.parse(raw); capture(); });
    await context.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        setItem.call(this, name, value);
        if (name === 'pending') void window.capturePending(value);
      };
    });
    await context.route('**/api/exchange', async (route) => {
      exchangeCount++;
      expect(route.request().postDataJSON()).toEqual({ code: 'example-code', codeVerifier: pending.verifier, redirectUri: new URL(page.url()).origin + '/' });
      if (outcome === 'rejected') return route.fulfill({ status: 401, json: {} });
      return route.fulfill({ headers: { 'set-cookie': 'session=example-member; Path=/; HttpOnly; SameSite=Lax' }, json: {} });
    });
    await context.route('https://identity.example/**', async (route) => {
      // Intercept before any provider traffic; retain this tab's sessionStorage across redirect.
      const url = new URL(route.request().url());
      await pendingReady;
      expect(url.searchParams.get('state')).toBe(pending.state);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.verifier).digest('base64url'));
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', outcome === 'mismatched-state' ? 'wrong' : pending.state);
      callback.searchParams.set(outcome === 'cancel' ? 'error' : 'code', outcome === 'cancel' ? 'access_denied' : 'example-code');
      await route.fulfill({ status: 302, headers: { location: callback.href } });
    });
    await page.goto('./');
    await page.getByRole('button', { name: 'Continue with provider' }).click();
    await expect(page.getByRole('status')).toHaveText(outcome === 'success' ? 'Signed in' : 'Signed out');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    expect(exchangeCount).toBe(['success', 'rejected'].includes(outcome) ? 1 : 0);
    expect(await page.evaluate(() => sessionStorage.getItem('pending'))).toBeNull();
  });
}

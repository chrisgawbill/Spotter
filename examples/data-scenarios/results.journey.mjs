const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

const item = (overrides = {}) => ({ name: 'Alpha', score: 12, note: 'Ready', ...overrides });
const variants = {
  empty: { items: [] },
  long: { items: [item({ note: 'A'.repeat(500) })] },
  missing: { items: [item({ note: undefined })] },
  large: { items: Array.from({ length: 200 }, (_, index) => item({ name: `Team ${index + 1}`, score: index })) },
  unicode: { items: [item({ name: '東京 🏒', note: 'Crème brûlée — مرحبا' })] },
  zero: { items: [item({ score: 0 })] },
  unexpected: { results: [item()] },
};

async function scenario({ page }, testInfo, name, verify) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
  await page.route('**/api/results', (route) => route.fulfill({ json: variants[name] }));
  await page.goto('./');
  try {
    await expect(page.getByText('Loading…')).toHaveCount(0);
    expect(pageErrors, `${name}: uncaught page errors`).toEqual([]);
    expect(consoleErrors, `${name}: console errors`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal layout`).toBe(true);
    await verify(page);
  } finally {
    await testInfo.attach(`data-scenario-${name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
}

test('Data Verify: empty results render an empty state @critical', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'empty', async (p) => {
    await expect(p.getByRole('status')).toHaveText('No results');
    await expect(p.getByRole('listitem')).toHaveCount(0);
  });
});

test('Data Verify: long text wraps without horizontal overflow @critical', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'long', async (p) => expect(p.getByRole('listitem')).toContainText('A'.repeat(100)));
});

test('Data Verify: missing optional fields use a fallback @critical', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'missing', async (p) => expect(p.getByRole('listitem')).toContainText('—'));
});

test('Data Verify: large lists render every item', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'large', async (p) => expect(p.getByRole('listitem')).toHaveCount(200));
});

test('Data Verify: Unicode text is preserved', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'unicode', async (p) => {
    await expect(p.getByRole('listitem')).toContainText('東京 🏒');
    await expect(p.getByRole('listitem')).toContainText('Crème brûlée — مرحبا');
  });
});

test('Data Verify: zero values remain visible', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'zero', async (p) => expect(p.locator('.score')).toHaveText('0'));
});

test('Data Verify: unexpected response shapes show a safe state', async ({ page }, testInfo) => {
  await scenario({ page }, testInfo, 'unexpected', async (p) => expect(p.getByRole('alert')).toHaveText('Data unavailable'));
});

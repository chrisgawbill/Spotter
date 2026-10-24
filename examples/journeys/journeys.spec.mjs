const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

let items;
let writes;

// Routing lives in the spec because the project owns its payloads and persistence.
test.beforeEach(async ({ page }) => {
  items = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }, { id: 3, name: 'Charlie' }];
  writes = [];
  await page.route('**/api/items**', async (route) => {
    const request = route.request();
    const id = Number(new URL(request.url()).pathname.split('/')[3]);
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      writes.push(body);
      await new Promise((resolve) => setTimeout(resolve, 200)); // a double click lands while pending
      items = items.map((item) => (item.id === id ? { ...item, ...body } : item));
      return route.fulfill({ json: items.find((item) => item.id === id) });
    }
    return route.fulfill({ json: id ? items.find((item) => item.id === id) : items });
  });
});

const save = (page) => page.getByRole('button', { name: 'Save' });

test('Journey Verify: invalid name is rejected, then the corrected name saves @critical', async ({ page }) => {
  await page.goto('./#/items/1');
  await page.getByLabel('Name').fill('ab');
  await save(page).click();
  await expect(page.getByRole('alert')).toHaveText('Name must be at least 3 characters');
  expect(writes).toEqual([]);
  await page.getByLabel('Name').fill('Alpha 2');
  await save(page).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('alert')).toHaveText('');
  expect(writes).toEqual([{ name: 'Alpha 2' }]);
});

test('Journey Verify: a double-clicked Save sends one write @critical', async ({ page }) => {
  await page.goto('./#/items/1');
  await page.getByLabel('Name').fill('Alpha 2');
  await save(page).dblclick();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(writes).toHaveLength(1);
});

test('Journey Verify: an edit persists after reload', async ({ page }) => {
  await page.goto('./#/items/1');
  await page.getByLabel('Name').fill('Alpha 2');
  await save(page).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Name')).toHaveValue('Alpha 2');
  await page.goto('./#/items');
  await expect(page.getByRole('link', { name: 'Alpha 2' })).toBeVisible();
});

test('Journey Verify: filter and page survive reload and back/forward', async ({ page }) => {
  const status = page.getByRole('status');
  await page.goto('./#/items');
  await expect(status).toHaveText('Page 1 of 2');
  await page.getByLabel('Filter').fill('a');
  await expect(page).toHaveURL(/#\/items\?q=a$/);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/#\/items\?q=a&page=2$/);
  await expect(status).toHaveText('Page 2 of 2');
  await page.reload();
  await expect(page.getByLabel('Filter')).toHaveValue('a');
  await expect(status).toHaveText('Page 2 of 2');
  await page.goBack();
  await expect(page).toHaveURL(/#\/items\?q=a$/);
  await expect(status).toHaveText('Page 1 of 2');
  await page.goBack();
  await expect(page).toHaveURL(/#\/items$/);
  await expect(page.getByLabel('Filter')).toHaveValue('');
  await page.goForward();
  await expect(page).toHaveURL(/#\/items\?q=a$/);
  await expect(page.getByLabel('Filter')).toHaveValue('a');
});

test('Journey Verify: the delete dialog works by keyboard and restores focus', async ({ page }) => {
  await page.goto('./#/items');
  const opener = page.getByRole('button', { name: 'Delete…' }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Delete Alpha?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Journey Verify: the admin route requires the admin role @critical', async ({ page }) => {
  await page.goto('./#/admin');
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toHaveCount(0);
});

test.describe(() => {
  test.use({ spotterSession: 'admin' });
  test('Journey Verify: an admin can open the admin route', async ({ page }) => {
    await page.goto('./#/admin');
    await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  });
});

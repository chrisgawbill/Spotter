const { test, expect } = await import(process.env.SPOTTER_TEST_MODULE);

test('Performance Verify: opening details is quick @perf', async ({ page, spotterTiming }) => {
  await page.goto('./');
  await expect(page.getByRole('listitem').first()).toBeVisible();
  const details = page.getByRole('region', { name: 'Details' });
  await spotterTiming('open details', async () => {
    await page.getByRole('button', { name: 'Open details' }).click();
    await expect(details).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';

test('an invalid stored token signs the user out with a visible warning', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'invalid-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'stale', email: 'stale@example.com', displayName: 'Stale user' }),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Your session expired. Please log in again.',
  );
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});

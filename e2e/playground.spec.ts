import { expect, test } from '@playwright/test';

test('§13.1 example checks clean with no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  const status = page.locator('tartlet-player').locator('span[aria-live]');
  await expect(status).toHaveText('Ready: 3 of 3 tracks playable');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(status).toHaveText(/Playing|unavailable/);
  expect(violations).toEqual([]);
});

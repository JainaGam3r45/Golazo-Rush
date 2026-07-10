import { test, expect } from '@playwright/test';

test.describe('Online mode gate', () => {
  test('guest sees login CTA and cannot use online entry', async ({ page }) => {
    await page.goto('/play');

    await page.locator('[data-play-mode-btn="online"]').click();

    await expect(page.locator('[data-online-room]')).toBeVisible();
    await expect(page.locator('[data-online-auth-cta]')).toBeVisible();
    await expect(page.locator('[data-online-auth-cta]').getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.locator('[data-online-entry]')).toBeHidden();
    await expect(page.locator('[data-cpu-flow]')).toBeHidden();
  });

  test('cpu mode remains available after toggling online', async ({ page }) => {
    await page.goto('/play');
    await page.locator('[data-play-mode-btn="online"]').click();
    await expect(page.locator('[data-online-room]')).toBeVisible();

    await page.locator('[data-play-mode-btn="cpu"]').click();
    await expect(page.locator('[data-cpu-flow]')).toBeVisible();
    await expect(page.locator('[data-online-room]')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Partido' })).toBeVisible();
  });
});

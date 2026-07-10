import { test, expect, type Page } from '@playwright/test';

async function enterPlayHub(page: Page) {
  await page.goto('/play');
  await expect(page.locator('[data-enter-without-fs]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-enter-without-fs]').click();
  await expect(page.locator('[data-shell-panel="hub"]')).toBeVisible();
}

test.describe('Online mode gate', () => {
  test('guest sees login CTA and cannot use online entry', async ({ page }) => {
    await enterPlayHub(page);
    await page.locator('[data-hub-card="online"]').click();

    await expect(page.locator('[data-online-room]')).toBeVisible();
    await expect(page.locator('[data-online-view="guest"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-online-view="guest"]').getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.locator('[data-online-create]')).toBeHidden();
    await expect(page.locator('[data-online-join]')).toBeHidden();
    await expect(page.locator('[data-play-lobby]')).toBeVisible();
  });

  test('cpu mode remains available after opening online', async ({ page }) => {
    await enterPlayHub(page);
    await page.locator('[data-hub-card="online"]').click();
    await expect(page.locator('[data-online-room]')).toBeVisible();

    await page.locator('[data-hub-back-online]').click();
    await page.locator('[data-hub-card="cpu"]').click();
    await expect(page.locator('[data-team-selector]')).toBeVisible();
    await expect(page.locator('[data-online-room]')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: /Jugar/i })).toBeVisible();
  });
});

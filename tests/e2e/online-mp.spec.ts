import { test, expect } from '@playwright/test';

/**
 * Additive online multiplayer UI smoke: guest CTA + CPU regression.
 * Complements tests/e2e/online-room.spec.ts without replacing it.
 */
test.describe('Online multiplayer UI (guest + CPU)', () => {
  test('guest sees login CTA and cannot use online entry', async ({ page }) => {
    await page.goto('/play');

    await page.locator('[data-play-mode-btn="online"]').click();

    await expect(page.locator('[data-online-room]')).toBeVisible();
    await expect(page.locator('[data-online-view="guest"]')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-online-view="guest"]').getByRole('link', { name: 'Iniciar sesión' }),
    ).toBeVisible();
    await expect(page.locator('[data-online-create]')).toBeHidden();
    await expect(page.locator('[data-cpu-flow]')).toBeHidden();
  });

  test('cpu mode remains available after toggling online', async ({ page }) => {
    await page.goto('/play');
    await page.locator('[data-play-mode-btn="online"]').click();
    await expect(page.locator('[data-online-room]')).toBeVisible();

    await page.locator('[data-play-mode-btn="cpu"]').click();
    await expect(page.locator('[data-cpu-flow]')).toBeVisible();
    await expect(page.locator('[data-online-room]')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: /PARTIDO/i })).toBeVisible();
  });

  test('shows Contra bots copy and hides lobby on cpu mode', async ({ page }) => {
    await page.goto('/play');

    await expect(page.getByRole('tab', { name: /Contra bots/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Online 1v1/i })).toBeVisible();
    await expect(page.locator('[data-play-lobby]')).toBeHidden();

    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();
    await expect(page.locator('[data-preview-mode-badge]')).toContainText('Contra bots');
    await expect(page.locator('[data-preview-mode-badge]')).not.toContainText('vs CPU');
  });
});

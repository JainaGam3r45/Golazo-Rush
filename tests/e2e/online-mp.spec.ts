import { test, expect, type Page } from '@playwright/test';

async function enterPlayHub(page: Page) {
  await page.goto('/play');
  await expect(page.locator('[data-enter-without-fs]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-enter-without-fs]').click();
  await expect(page.locator('[data-shell-panel="hub"]')).toBeVisible();
}

/**
 * Additive online multiplayer UI smoke: guest CTA + CPU regression.
 * Complements tests/e2e/online-room.spec.ts without replacing it.
 */
test.describe('Online multiplayer UI (guest + CPU)', () => {
  test('guest sees login CTA and cannot use online entry', async ({ page }) => {
    await enterPlayHub(page);
    await page.locator('[data-hub-card="online"]').click();

    await expect(page.locator('[data-online-room]')).toBeVisible();
    await expect(page.locator('[data-online-view="guest"]')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-online-view="guest"]').getByRole('link', { name: 'Iniciar sesión' }),
    ).toBeVisible();
    await expect(page.locator('[data-online-create]')).toBeHidden();
  });

  test('cpu mode remains available after opening online', async ({ page }) => {
    await enterPlayHub(page);
    await page.locator('[data-hub-card="online"]').click();
    await expect(page.locator('[data-online-room]')).toBeVisible();

    await page.locator('[data-hub-back-online]').click();
    await page.locator('[data-hub-card="cpu"]').click();
    await expect(page.locator('[data-team-selector]')).toBeVisible();
    await expect(page.locator('[data-online-room]')).toBeHidden();
  });

  test('shows Contra bots copy on hub and preview', async ({ page }) => {
    await enterPlayHub(page);

    await expect(page.locator('[data-hub-card="cpu"]')).toContainText(/Contra bots/i);
    await expect(page.locator('[data-hub-card="online"]')).toContainText(/Online 1v1/i);

    await page.locator('[data-hub-card="cpu"]').click();
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();
    await expect(page.locator('[data-preview-mode-badge]')).toContainText('Contra bots');
    await expect(page.locator('[data-preview-mode-badge]')).toContainText('11v11');
    await expect(page.locator('[data-preview-mode-badge]')).not.toContainText('vs CPU');
  });
});

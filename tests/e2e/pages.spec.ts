import { test, expect } from '@playwright/test';

test.describe('Home', () => {
  test('shows hero title, play link, ranking nav, and team flags', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Golazo Rush' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Jugar ahora' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Ranking' })).toBeVisible();

    const flags = page.locator('.country-flag');
    expect(await flags.count()).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Ranking', () => {
  test('shows global ranking with team cards and flags', async ({ page }) => {
    await page.goto('/ranking');

    await expect(page.getByRole('heading', { level: 1, name: 'Ranking mundial' })).toBeVisible();
    await expect(page.locator('[data-ranking-list]')).toBeVisible();

    const teamCards = page.locator('.team-card');
    expect(await teamCards.count()).toBeGreaterThanOrEqual(3);

    await expect(page.getByText('Brasil')).toBeVisible();
    await expect(page.getByText('Argentina')).toBeVisible();

    const flags = page.locator('.team-card .country-flag');
    expect(await flags.count()).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Play', () => {
  test('does not auto-start the game canvas on load', async ({ page }) => {
    await page.goto('/play');

    await expect(page.getByRole('heading', { level: 1, name: 'Partido' })).toBeVisible();
    await expect(page.locator('#game-container canvas')).toHaveCount(0);
  });

  test('full flow: select team, preview, play, canvas visible', async ({ page }) => {
    await page.goto('/play');

    await expect(page.locator('[data-team-selector]')).toBeVisible();
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();

    await expect(page.locator('[data-match-preview]')).toBeVisible();
    await expect(page.locator('[data-play-match]')).toBeEnabled();

    await page.locator('[data-play-match]').click();

    const gameContainer = page.locator('#game-container');
    await expect(gameContainer).toBeVisible();
    await expect(gameContainer.locator('canvas')).toBeVisible({ timeout: 10_000 });
  });
});

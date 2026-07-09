import { test, expect } from '@playwright/test';

test.describe('Home', () => {
  test('shows hero title, play link, and ranking nav', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Golazo Rush' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Jugar ahora' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Ranking' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Entrar' })).toBeVisible();
  });
});

test.describe('Ranking', () => {
  test('shows global ranking or empty state with team flags when populated', async ({ page }) => {
    await page.goto('/ranking');

    await expect(page.getByRole('heading', { level: 1, name: 'Ranking mundial' })).toBeVisible();

    const teamCards = page.locator('.team-card');
    const emptyState = page.getByText('Aún no hay partidos registrados');
    const cardCount = await teamCards.count();

    if (cardCount > 0) {
      expect(cardCount).toBeGreaterThanOrEqual(3);
      await expect(page.getByText('Brasil')).toBeVisible();
      await expect(page.getByText('Argentina')).toBeVisible();

      const flags = page.locator('.team-card .country-flag__img');
      expect(await flags.count()).toBeGreaterThanOrEqual(3);
      await expect(flags.first()).toHaveAttribute('src', /\/flags\/.+\.svg/);
    } else {
      await expect(emptyState).toBeVisible();
    }
  });
});

test.describe('Play', () => {
  test('does not auto-start the game canvas on load', async ({ page }) => {
    await page.goto('/play');

    await expect(page.getByRole('heading', { level: 1, name: 'Partido' })).toBeVisible();
    await expect(page.locator('#game-container canvas')).toHaveCount(0);
  });

  test('team selector shows real flag images', async ({ page }) => {
    await page.goto('/play');

    await expect(page.locator('[data-team-selector]')).toBeVisible();
    const brFlag = page.locator('[data-team-selector] img[src*="/flags/br.svg"]');
    await expect(brFlag).toBeVisible();
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

  test('HUD shows CPU mode after match starts', async ({ page }) => {
    await page.goto('/play');
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();
    await page.locator('[data-play-match]').click();

    await expect(page.locator('#match-mode')).toContainText('Partido rápido vs CPU');
  });

  test('guest banner mentions playing as guest', async ({ page }) => {
    await page.goto('/play');

    const session = page.locator('[data-play-session]');
    await expect(session).toBeVisible({ timeout: 10_000 });
    await expect(session).toContainText(/invitado/i);
  });

  test('match clock uses clean M:SS format', async ({ page }) => {
    await page.goto('/play');
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();
    await page.locator('[data-play-match]').click();

    const clock = page.locator('#match-clock');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/^\d+:\d{2}$/);
  });

  test('match HUD shows fullscreen and mute controls', async ({ page }) => {
    await page.goto('/play');
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();
    await page.locator('[data-play-match]').click();

    await expect(page.locator('[data-fullscreen]')).toBeVisible();
    await expect(page.locator('[data-mute]')).toBeVisible();
  });

  test('guest does not see formation selector', async ({ page }) => {
    await page.goto('/play');
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();

    const selector = page.locator('[data-formation-selector]');
    await expect(selector).toBeHidden();
    await expect(page.locator('[data-formation-guest]')).toBeVisible();
  });
});

test.describe('Auth pages', () => {
  test('login page loads with form and OAuth buttons', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page.locator('[data-login-form] input[name="email"]')).toBeVisible();
    await expect(page.locator('[data-login-form] input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar con Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar con Discord' })).toBeVisible();
    await expect(page.locator('button[data-oauth="google"]')).toHaveAttribute('data-oauth', 'google');
    await expect(page.locator('button[data-oauth="discord"]')).toHaveAttribute('data-oauth', 'discord');
  });

  test('register page loads with form and OAuth buttons', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
    await expect(page.locator('[data-register-form] input[name="name"]')).toBeVisible();
    await expect(page.locator('[data-register-form] input[name="email"]')).toBeVisible();
    await expect(page.locator('[data-register-form] input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar con Discord' })).toBeVisible();
    await expect(page.locator('button[data-oauth="google"]')).toHaveAttribute('data-oauth', 'google');
    await expect(page.locator('button[data-oauth="discord"]')).toHaveAttribute('data-oauth', 'discord');
  });

  test('OAuth buttons never request /oauth/undefined', async ({ page }) => {
    const oauthRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/auth/oauth/')) {
        oauthRequests.push(url);
      }
    });

    await page.goto('/login');
    await page.locator('button[data-oauth="google"]').click();
    await page.waitForTimeout(400);

    await page.goto('/register');
    await page.locator('button[data-oauth="discord"]').click();
    await page.waitForTimeout(400);

    for (const url of oauthRequests) {
      expect(url).not.toContain('/oauth/undefined');
      expect(url).toMatch(/\/api\/auth\/oauth\/(google|discord)/);
    }
  });

  test('account page does not break without session', async ({ page }) => {
    await page.goto('/cuenta');

    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
    await expect(page.locator('[data-account-guest]')).toBeVisible();
    await expect(page.locator('[data-account-guest]').getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(page.locator('[data-account-guest]').getByRole('link', { name: 'Crear cuenta' })).toBeVisible();
  });
});


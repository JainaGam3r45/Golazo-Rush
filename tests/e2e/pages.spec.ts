import { test, expect, type Page } from '@playwright/test';

/** Enter immersive shell without native fullscreen (CSS immersive fallback). */
async function enterPlayHub(page: Page) {
  await page.goto('/play');
  await expect(page.locator('#game-shell')).toBeVisible();
  await expect(page.locator('[data-enter-without-fs]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-enter-without-fs]').click();
  await expect(page.locator('[data-shell-panel="hub"]')).toBeVisible();
}

async function openContraBots(page: Page) {
  await enterPlayHub(page);
  await page.locator('[data-hub-card="cpu"]').click();
  await expect(page.locator('[data-team-selector]')).toBeVisible();
}

async function openOnlineHub(page: Page) {
  await enterPlayHub(page);
  await page.locator('[data-hub-card="online"]').click();
  await expect(page.locator('[data-online-room]')).toBeVisible();
}

async function startCpuMatch(page: Page) {
  await openContraBots(page);
  await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
  await page.locator('[data-continue-team]').click();
  await page.locator('[data-play-match]').click();
}

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

      const flags = page.locator('.team-card .country-flag__svg use');
      expect(await flags.count()).toBeGreaterThanOrEqual(3);
      await expect(flags.first()).toHaveAttribute('href', /#flag-/);
    } else {
      await expect(emptyState).toBeVisible();
    }
  });
});

test.describe('Play', () => {
  test('immersive shell has no site nav or footer', async ({ page }) => {
    await page.goto('/play');
    await expect(page.locator('#game-shell')).toBeVisible();
    await expect(page.locator('.site-nav')).toHaveCount(0);
    await expect(page.locator('.site-footer')).toHaveCount(0);
  });

  test('does not auto-start the game canvas on load', async ({ page }) => {
    await page.goto('/play');
    await expect(page.locator('[data-enter-game]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#game-container canvas')).toHaveCount(0);
  });

  test('entry requires click; no auto fullscreen', async ({ page }) => {
    await page.goto('/play');
    await expect(page.locator('[data-enter-game]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-enter-without-fs]')).toBeVisible();
    const fs = await page.evaluate(() => Boolean(document.fullscreenElement));
    expect(fs).toBe(false);
  });

  test('keeps zero canvases after 5 seconds idle', async ({ page }) => {
    await page.goto('/play');
    await page.waitForTimeout(5000);
    await expect(page.locator('#game-container canvas')).toHaveCount(0);
  });

  test('creates exactly one canvas after starting a match', async ({ page }) => {
    await startCpuMatch(page);
    const canvas = page.locator('#game-container canvas');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await expect(canvas).toHaveCount(1);
  });

  test('restart keeps at most one canvas', async ({ page }) => {
    await startCpuMatch(page);
    await expect(page.locator('#game-container canvas')).toHaveCount(1, { timeout: 10_000 });

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('golazo:restart-match'));
    });

    await expect(page.locator('[data-match-preview]')).toBeVisible();
    await expect(page.locator('#game-container canvas')).toHaveCount(0);

    await page.locator('[data-play-match]').click();
    await expect(page.locator('#game-container canvas')).toHaveCount(1, { timeout: 10_000 });
  });

  test('team selector shows flag sprites', async ({ page }) => {
    await openContraBots(page);
    const brFlag = page.locator('[data-team-selector] .country-flag__svg use[href="#flag-br"]');
    await expect(brFlag).toBeVisible();
  });

  test('control hints available via Menú Controles', async ({ page }) => {
    await startCpuMatch(page);
    await page.locator('[data-match-menu]').click();
    await page.locator('[data-menu-controls]').click();
    const help = page.locator('[data-controls-help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText(/E/i);
    await expect(help).toContainText(/pase/i);
    await expect(help).toContainText(/Q/i);
    await expect(help).toContainText(/despeje/i);
    await expect(help).toContainText(/F/i);
    await expect(help).toContainText(/entrada/i);
  });

  test('preview shows fixed 11v11 format and lineup editor', async ({ page }) => {
    await openContraBots(page);
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();

    await expect(page.locator('[data-preview-mode-badge]')).toContainText(/11v11/i);
    await expect(page.locator('[data-format-block]')).toContainText(/11v11/i);
    await expect(page.locator('[data-lineup-editor]')).toBeVisible();
    await expect(page.locator('.lineup-editor__chip')).toHaveCount(10);
  });

  test('offers 10, 15, 30, and 45 minute durations', async ({ page }) => {
    await openContraBots(page);
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();

    await expect(page.locator('[data-duration]')).toHaveText(['10 min', '15 min', '30 min', '45 min']);
  });

  test('shows the result panel when a match ends', async ({ page }) => {
    await startCpuMatch(page);
    await expect(page.locator('#game-container canvas')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('golazo:match-ended', {
          detail: {
            localMatchId: 'test-match',
            homeTeamId: 'brasil',
            awayTeamId: 'argentina',
            homeScore: 2,
            awayScore: 1,
            durationSeconds: 900,
          },
        }),
      );
    });

    await expect(page.locator('[data-match-result]')).toBeVisible();
    await expect(page.locator('[data-result-duration]')).toHaveText('Duración: 15 min');
  });

  test('starts 11v11 match with HUD mode', async ({ page }) => {
    await startCpuMatch(page);
    await expect(page.locator('#game-container canvas')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#match-mode')).toContainText(/11v11/i);
    await expect(page.locator('[data-stoppage]')).toBeVisible();
  });

  test('lineup editor is available before kickoff', async ({ page }) => {
    await openContraBots(page);
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();
    await expect(page.locator('[data-preview-mode-badge]')).toContainText(/11v11/i);
    await expect(page.locator('.lineup-editor__reset')).toBeVisible();
    await page.locator('[data-play-match]').click();

    await expect(page.locator('#game-container canvas')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#match-mode')).toContainText(/11v11/i);
  });

  test('full flow: select team, preview, play, canvas visible', async ({ page }) => {
    await openContraBots(page);
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();

    await expect(page.locator('[data-match-preview]')).toBeVisible();
    await expect(page.locator('[data-play-match]')).toBeEnabled();

    await page.locator('[data-play-match]').click();

    const gameContainer = page.locator('#game-container');
    await expect(gameContainer).toBeVisible();
    await expect(gameContainer.locator('canvas')).toBeVisible({ timeout: 10_000 });
    await expect(gameContainer.locator('canvas')).toHaveCount(1);
  });

  test('HUD shows Contra bots mode after match starts', async ({ page }) => {
    await startCpuMatch(page);
    await expect(page.locator('#match-mode')).toContainText(/11v11.*Contra bots/i);
  });

  test('HUD shows control instructions during match', async ({ page }) => {
    await startCpuMatch(page);
    await page.locator('[data-match-menu]').click();
    await page.locator('[data-menu-controls]').click();
    const help = page.locator('[data-controls-help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText(/WASD/i);
    await expect(help).toContainText(/E/i);
    await expect(help).toContainText(/Q/i);
    await expect(help).toContainText(/F/i);
  });

  test('guest banner mentions playing as guest', async ({ page }) => {
    await enterPlayHub(page);
    const session = page.locator('[data-play-session]');
    await expect(session).toBeVisible({ timeout: 10_000 });
    await expect(session).toContainText(/invitado/i);
  });

  test('match clock uses clean M:SS format', async ({ page }) => {
    await startCpuMatch(page);
    const clock = page.locator('#match-clock');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/^\d+:\d{2}$/);
  });

  test('match HUD shows menu and mute controls', async ({ page }) => {
    await startCpuMatch(page);
    await expect(page.locator('[data-match-menu]')).toBeVisible();
    await expect(page.locator('[data-mute]')).toBeVisible();
  });

  test('mute toggles label and persists preference', async ({ page }) => {
    await startCpuMatch(page);
    const muteBtn = page.locator('[data-mute]');
    await expect(muteBtn).toBeVisible();
    const before = await muteBtn.getAttribute('aria-label');
    await muteBtn.click();
    await expect(muteBtn).not.toHaveAttribute('aria-label', before ?? '');

    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('golazo:sound-muted')))
      .toMatch(/^(true|false)$/);
  });

  test('guest can edit lineup before playing', async ({ page }) => {
    await openContraBots(page);
    await page.locator('[data-team-selector] button[data-team-id="brasil"]').click();
    await page.locator('[data-continue-team]').click();

    const editor = page.locator('[data-lineup-editor]');
    await expect(editor).toBeVisible();
    await expect(page.locator('.lineup-editor__chip--you')).toBeVisible();
  });

  test('canvas stays singular across resize', async ({ page }) => {
    await startCpuMatch(page);
    await expect(page.locator('#game-container canvas')).toHaveCount(1, { timeout: 10_000 });
    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForTimeout(300);
    await expect(page.locator('#game-container canvas')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await expect(page.locator('#game-container canvas')).toHaveCount(1);
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
      expect(url).toContain('code_challenge=');
      expect(url).toContain('redirect_uri=');
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

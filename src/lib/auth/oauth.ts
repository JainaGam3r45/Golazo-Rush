import { insforge, isInsForgeConfigured } from '../insforge';
import { fetchProfile, upsertProfile } from '../profile/store';
import { getSelectedTeam } from '../storage/selectedTeam';
import { hydrateSession, type SessionUser } from './session';
import { mapAuthError } from './errors';

export type OAuthProvider = 'google' | 'discord';

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'discord'];

export function getOAuthRedirectUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

function mapOAuthError(error: { message?: string; statusCode?: number }): string {
  const message = (error.message ?? '').toLowerCase();

  if (message.includes('provider') && message.includes('not')) {
    return 'Este proveedor no está disponible en este momento.';
  }

  if (message.includes('redirect')) {
    return 'No se pudo iniciar la sesión. Inténtalo de nuevo.';
  }

  return mapAuthError(error, true);
}

export async function signInWithOAuthProvider(
  provider: OAuthProvider,
): Promise<{ error: string | null }> {
  if (!isInsForgeConfigured || !insforge) {
    return { error: mapAuthError(null, false) };
  }

  try {
    const { error } = await insforge.auth.signInWithOAuth(provider, {
      redirectTo: getOAuthRedirectUrl(),
    });

    if (error) {
      return { error: mapOAuthError(error) };
    }

    return { error: null };
  } catch {
    return { error: mapAuthError({ message: 'network' }, true) };
  }
}

export async function completeOAuthProfile(user: SessionUser): Promise<void> {
  const localTeam = getSelectedTeam();
  const existing = await fetchProfile(user.id);

  if (!existing) {
    await upsertProfile(user, {
      display_name: user.name ?? null,
      selected_team_id: localTeam,
    });
    return;
  }

  const updates: { display_name?: string | null; selected_team_id?: string | null } = {};

  if (!existing.display_name && user.name) {
    updates.display_name = user.name;
  }

  if (!existing.selected_team_id && localTeam) {
    updates.selected_team_id = localTeam;
  }

  if (Object.keys(updates).length > 0) {
    await upsertProfile(user, updates);
  }
}

async function waitForOAuthSession(): Promise<SessionUser | null> {
  const params = new URLSearchParams(window.location.search);
  const hasOAuthCode = params.has('insforge_code');
  const attempts = hasOAuthCode ? 15 : 3;
  const delayMs = hasOAuthCode ? 400 : 200;

  for (let i = 0; i < attempts; i += 1) {
    const user = await hydrateSession();
    if (user) return user;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

export async function completeOAuthSession(): Promise<{
  user: SessionUser | null;
  error: string | null;
}> {
  if (!isInsForgeConfigured || !insforge) {
    return { user: null, error: mapAuthError(null, false) };
  }

  const user = await waitForOAuthSession();

  if (!user) {
    return { user: null, error: 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.' };
  }

  await completeOAuthProfile(user);
  return { user, error: null };
}

export function wireOAuthButtons(containerSelector: string, errorSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector);
  const errorEl = document.querySelector<HTMLElement>(errorSelector);
  if (!container) return;

  const buttons = container.querySelectorAll<HTMLButtonElement>('[data-oauth]');

  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const provider = btn.dataset.oauth as OAuthProvider | undefined;
      if (!provider) return;

      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }

      buttons.forEach((b) => {
        b.disabled = true;
      });

      const { error } = await signInWithOAuthProvider(provider);

      if (error) {
        if (errorEl) {
          errorEl.textContent = error;
          errorEl.hidden = false;
        }
        buttons.forEach((b) => {
          b.disabled = false;
        });
      }
    });
  });
}

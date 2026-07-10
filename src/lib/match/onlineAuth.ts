/**
 * Online access token helpers — delegates to the unified session controller.
 * Diagnostic inject remains for `/dev/ws-probe` only.
 */

import {
  clearSessionAccessTokenInject,
  ensureAccessToken,
  getAuthState,
  hydrateSession,
  injectSessionAccessToken,
  refreshSessionOnce,
} from '../auth/session';

export type OnlineTokenSource = 'inject' | 'sdk-session' | 'sdk-refresh' | 'none';

export type OnlineTokenResult = {
  token: string | null;
  source: OnlineTokenSource;
  reason?: string;
};

export { parseBearerToken, accessTokenFromRefreshPayload } from './onlineAuthToken';

type ResolveOptions = {
  forceRefresh?: boolean;
};

/** Diagnostic override for `/dev/ws-probe`. Do not use in production UI. */
export function injectOnlineAccessToken(token: string | null): void {
  injectSessionAccessToken(token);
}

export function getInjectedOnlineAccessToken(): string | null {
  return getAuthState().accessToken;
}

export function clearOnlineAccessTokenInject(): void {
  clearSessionAccessTokenInject();
}

/**
 * Best-effort access token for private-room HTTP (Bearer) and WS join.
 * Uses the unified session store — never logs the token.
 */
export async function resolveOnlineAccessToken(
  options: ResolveOptions = {},
): Promise<OnlineTokenResult> {
  await hydrateSession();
  const auth = getAuthState();
  if (!auth.user && !auth.loading) {
    return {
      token: null,
      source: 'none',
      reason: 'Inicia sesión para jugar online.',
    };
  }

  const token = options.forceRefresh
    ? await refreshSessionOnce()
    : await ensureAccessToken({ force: options.forceRefresh });

  if (token) {
    return {
      token,
      source: options.forceRefresh ? 'sdk-refresh' : 'sdk-session',
    };
  }

  const after = getAuthState();
  return {
    token: null,
    source: 'none',
    reason:
      after.tokenError ??
      'No se pudo obtener el access token de la sesión. Vuelve a iniciar sesión o recarga la página.',
  };
}

export async function hasOnlineAccessToken(): Promise<boolean> {
  const { token } = await resolveOnlineAccessToken();
  return Boolean(token);
}

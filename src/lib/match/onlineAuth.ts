/**
 * Resolve the current InsForge user access token for online multiplayer.
 *
 * Production path (SPA `@insforge/sdk`):
 * 1. `hydrateSession()` → `auth.getCurrentUser()` (refreshes via httpOnly cookie if needed)
 * 2. Read bearer from `client.getHttpClient().getHeaders()` (public API; user token after hydrate)
 * 3. If missing/stale: `auth.refreshSession()` and use `data.accessToken` from the response
 *
 * Identity always comes from the verified JWT on the server — never from a free-form userId.
 * Diagnostic inject is for `/dev/ws-probe` only; it is cleared on sign-out.
 */

import { hydrateSession, subscribeAuth } from '../auth/session';
import { insforge, isInsForgeConfigured } from '../insforge';

export type OnlineTokenSource = 'inject' | 'sdk-session' | 'sdk-refresh' | 'none';

export type OnlineTokenResult = {
  token: string | null;
  source: OnlineTokenSource;
  reason?: string;
};

type ResolveOptions = {
  /** Force `auth.refreshSession()` even if a bearer is already on the HTTP client. */
  forceRefresh?: boolean;
};

let injectedToken: string | null = null;
let resolveInFlight: Promise<OnlineTokenResult> | null = null;
let resolveInFlightKey: string | null = null;

const anonKey =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.PUBLIC_INSFORGE_ANON_KEY as string | undefined)
    : undefined;

/** Diagnostic override for `/dev/ws-probe`. Do not use in production UI. */
export function injectOnlineAccessToken(token: string | null): void {
  injectedToken = token && token.trim() ? token.trim() : null;
}

export function getInjectedOnlineAccessToken(): string | null {
  return injectedToken;
}

export function clearOnlineAccessTokenInject(): void {
  injectedToken = null;
}

subscribeAuth((state) => {
  if (!state.user && !state.loading) {
    clearOnlineAccessTokenInject();
  }
});

/**
 * Parse a Bearer token from an Authorization header value.
 * Rejects empty values and any token in `rejectTokens` (e.g. the anon key).
 */
export function parseBearerToken(
  authorization: string | null | undefined,
  rejectTokens: ReadonlyArray<string | null | undefined> = [],
): string | null {
  if (!authorization || typeof authorization !== 'string') return null;
  const trimmed = authorization.trim();
  const match = /^Bearer\s+(\S+)/i.exec(trimmed);
  if (!match) return null;
  const token = match[1];
  if (!token) return null;
  for (const rejected of rejectTokens) {
    if (rejected && token === rejected) return null;
  }
  return token;
}

function readTokenFromHttpClient(): string | null {
  if (!insforge) return null;
  try {
    const headers = insforge.getHttpClient().getHeaders();
    return parseBearerToken(headers.Authorization ?? headers.authorization, [anonKey]);
  } catch {
    return null;
  }
}

function accessTokenFromRefreshPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec.accessToken === 'string' && rec.accessToken.trim()) {
    const token = rec.accessToken.trim();
    if (anonKey && token === anonKey) return null;
    return token;
  }
  return null;
}

async function resolveOnce(options: ResolveOptions = {}): Promise<OnlineTokenResult> {
  if (injectedToken) {
    return { token: injectedToken, source: 'inject' };
  }

  if (!isInsForgeConfigured || !insforge) {
    return {
      token: null,
      source: 'none',
      reason: 'InsForge no está configurado en el cliente.',
    };
  }

  const user = await hydrateSession();
  if (!user) {
    return {
      token: null,
      source: 'none',
      reason: 'Inicia sesión para jugar online.',
    };
  }

  if (!options.forceRefresh) {
    const fromSession = readTokenFromHttpClient();
    if (fromSession) {
      return { token: fromSession, source: 'sdk-session' };
    }
  }

  try {
    const { data, error } = await insforge.auth.refreshSession();
    if (!error) {
      const refreshed = accessTokenFromRefreshPayload(data);
      if (refreshed) {
        return { token: refreshed, source: 'sdk-refresh' };
      }
    }
  } catch {
    // fall through — try headers again in case refresh partially applied
  }

  const afterRefresh = readTokenFromHttpClient();
  if (afterRefresh) {
    return { token: afterRefresh, source: 'sdk-session' };
  }

  return {
    token: null,
    source: 'none',
    reason:
      'No se pudo obtener el access token de la sesión. Vuelve a iniciar sesión o recarga la página.',
  };
}

/**
 * Best-effort access token for private-room HTTP (Bearer) and WS join.
 * Dedupes concurrent callers. Never logs the token.
 */
export async function resolveOnlineAccessToken(
  options: ResolveOptions = {},
): Promise<OnlineTokenResult> {
  const key = options.forceRefresh ? 'force' : 'normal';
  if (resolveInFlight && resolveInFlightKey === key) {
    return resolveInFlight;
  }

  resolveInFlightKey = key;
  resolveInFlight = resolveOnce(options).finally(() => {
    resolveInFlight = null;
    resolveInFlightKey = null;
  });

  return resolveInFlight;
}

/** True when a usable user access token is available (after hydrate). */
export async function hasOnlineAccessToken(): Promise<boolean> {
  const { token } = await resolveOnlineAccessToken();
  return Boolean(token);
}

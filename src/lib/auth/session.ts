import { insforge, isInsForgeConfigured } from '../insforge';
import { accessTokenFromRefreshPayload, parseBearerToken } from '../match/onlineAuthToken';

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

export type SessionPhase =
  | 'hydrating'
  | 'guest'
  | 'authenticated'
  | 'refreshing'
  | 'expired'
  | 'error';

export type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  phase: SessionPhase;
  accessToken: string | null;
  sessionReady: boolean;
  tokenError: string | null;
};

type AuthListener = (state: AuthState) => void;

const anonKey =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.PUBLIC_INSFORGE_ANON_KEY as string | undefined)
    : undefined;

let state: AuthState = {
  user: null,
  loading: true,
  phase: 'hydrating',
  accessToken: null,
  sessionReady: false,
  tokenError: null,
};
const listeners = new Set<AuthListener>();
let hydratePromise: Promise<SessionUser | null> | null = null;
let sessionResolved = false;
let tokenPromise: Promise<string | null> | null = null;
let refreshAttempted = false;
let logoutCleanup: (() => void) | null = null;

function notify() {
  for (const listener of listeners) {
    listener(state);
  }
}

function mapUser(raw: { id: string; email?: string | null; profile?: { name?: string | null } | null }): SessionUser {
  return {
    id: raw.id,
    email: raw.email ?? '',
    name: raw.profile?.name ?? null,
  };
}

function derivePhase(partial: {
  loading: boolean;
  user: SessionUser | null;
  accessToken: string | null;
  refreshing?: boolean;
  expired?: boolean;
  error?: string | null;
}): SessionPhase {
  if (partial.loading) return 'hydrating';
  if (partial.refreshing) return 'refreshing';
  if (partial.expired) return 'expired';
  if (partial.error && !partial.user) return 'error';
  if (!partial.user) return 'guest';
  if (partial.user && !partial.accessToken && partial.error) return 'expired';
  return 'authenticated';
}

function authStatesEqual(a: AuthState, b: AuthState): boolean {
  return (
    a.loading === b.loading &&
    a.phase === b.phase &&
    a.accessToken === b.accessToken &&
    a.sessionReady === b.sessionReady &&
    a.tokenError === b.tokenError &&
    a.user?.id === b.user?.id &&
    a.user?.email === b.user?.email &&
    a.user?.name === b.user?.name
  );
}

function setState(next: Partial<AuthState> & { refreshing?: boolean; expired?: boolean }) {
  const user = next.user !== undefined ? next.user : state.user;
  const loading = next.loading !== undefined ? next.loading : state.loading;
  const accessToken = next.accessToken !== undefined ? next.accessToken : state.accessToken;
  const tokenError = next.tokenError !== undefined ? next.tokenError : state.tokenError;
  const phase =
    next.phase ??
    derivePhase({
      loading,
      user,
      accessToken,
      refreshing: next.refreshing,
      expired: next.expired,
      error: tokenError,
    });

  const nextState: AuthState = {
    user,
    loading,
    phase,
    accessToken,
    sessionReady: !loading && phase !== 'hydrating',
    tokenError,
  };

  // Avoid notify storms: callers like listFriends → ensureAccessToken used to
  // re-set identical auth and re-trigger subscribeAuth → infinite RPC loops.
  if (authStatesEqual(state, nextState)) {
    return;
  }

  state = nextState;
  notify();
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

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Register cleanup for room Realtime / WS when signing out (one handler). */
export function setSignOutCleanup(handler: (() => void) | null): void {
  logoutCleanup = handler;
}

export async function hydrateSession(): Promise<SessionUser | null> {
  if (!isInsForgeConfigured || !insforge) {
    setState({
      user: null,
      loading: false,
      accessToken: null,
      tokenError: null,
      phase: 'guest',
    });
    sessionResolved = true;
    return null;
  }

  if (hydratePromise) {
    return hydratePromise;
  }

  if (!sessionResolved) {
    setState({ loading: true, phase: 'hydrating' });
  }

  hydratePromise = (async () => {
    try {
      const { data, error } = await insforge!.auth.getCurrentUser();
      const user = !error && data?.user ? mapUser(data.user) : null;
      const token = user ? readTokenFromHttpClient() : null;
      refreshAttempted = false;
      setState({
        user,
        loading: false,
        accessToken: token,
        tokenError: null,
        phase: user ? 'authenticated' : 'guest',
      });
      sessionResolved = true;
      if (user && !token) {
        await ensureAccessToken();
      }
      return user;
    } catch {
      setState({
        user: null,
        loading: false,
        accessToken: null,
        tokenError: 'No se pudo comprobar la sesión.',
        phase: 'error',
      });
      sessionResolved = true;
      return null;
    } finally {
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

/**
 * Ensure a usable user Bearer token. At most one refresh attempt per hydrate cycle
 * unless `force` is true.
 */
export async function ensureAccessToken(options?: { force?: boolean }): Promise<string | null> {
  if (injectedToken) {
    setState({ accessToken: injectedToken, tokenError: null, phase: 'authenticated' });
    return injectedToken;
  }

  if (!isInsForgeConfigured || !insforge) {
    setState({ accessToken: null, tokenError: null });
    return null;
  }

  if (tokenPromise && !options?.force) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    const user = state.user ?? (await hydrateSession());
    if (!user) {
      setState({ accessToken: null, tokenError: null, phase: 'guest' });
      return null;
    }

    if (!options?.force) {
      const existing = state.accessToken ?? readTokenFromHttpClient();
      if (existing) {
        setState({ accessToken: existing, tokenError: null, phase: 'authenticated' });
        return existing;
      }
    }

    if (refreshAttempted && !options?.force) {
      setState({
        accessToken: null,
        tokenError: 'La sesión expiró. Vuelve a iniciar sesión.',
        expired: true,
      });
      return null;
    }

    setState({ refreshing: true, phase: 'refreshing' });
    refreshAttempted = true;

    try {
      const { data, error } = await insforge!.auth.refreshSession();
      if (!error) {
        const refreshed = accessTokenFromRefreshPayload(data, [anonKey]);
        if (refreshed) {
          setState({
            accessToken: refreshed,
            tokenError: null,
            phase: 'authenticated',
            loading: false,
          });
          return refreshed;
        }
      }
    } catch {
      // fall through
    }

    const after = readTokenFromHttpClient();
    if (after) {
      setState({ accessToken: after, tokenError: null, phase: 'authenticated', loading: false });
      return after;
    }

    setState({
      accessToken: null,
      tokenError: 'La sesión expiró. Vuelve a iniciar sesión.',
      expired: true,
      loading: false,
    });
    return null;
  })().finally(() => {
    tokenPromise = null;
  });

  return tokenPromise;
}

/** One forced refresh after expiry (UI “Reintentar sesión”). */
export async function refreshSessionOnce(): Promise<string | null> {
  refreshAttempted = false;
  return ensureAccessToken({ force: true });
}

export async function signOut(): Promise<void> {
  try {
    logoutCleanup?.();
  } catch {
    // ignore cleanup errors
  }
  logoutCleanup = null;

  if (isInsForgeConfigured && insforge) {
    try {
      await insforge.auth.signOut();
    } catch {
      // ignore sign-out errors
    }
  }

  clearInjectedToken();
  refreshAttempted = false;
  setState({
    user: null,
    loading: false,
    accessToken: null,
    tokenError: null,
    phase: 'guest',
  });
  sessionResolved = true;
}

/** Wait until the first hydrate finishes (`loading` becomes false). */
export function awaitAuthReady(): Promise<AuthState> {
  if (sessionResolved && !state.loading) {
    return Promise.resolve(state);
  }
  return new Promise((resolve) => {
    const unsub = subscribeAuth((next) => {
      if (!next.loading) {
        unsub();
        resolve(next);
      }
    });
  });
}

// --- diagnostic inject (dev probe only); kept here so session owns token truth ---

let injectedToken: string | null = null;

export function injectSessionAccessToken(token: string | null): void {
  injectedToken = token && token.trim() ? token.trim() : null;
  if (injectedToken && state.user) {
    setState({ accessToken: injectedToken, tokenError: null, phase: 'authenticated' });
  }
}

function clearInjectedToken(): void {
  injectedToken = null;
}

export function clearSessionAccessTokenInject(): void {
  clearInjectedToken();
}

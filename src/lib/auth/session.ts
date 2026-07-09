import { insforge, isInsForgeConfigured } from '../insforge';

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

type AuthListener = (state: AuthState) => void;

export type AuthState = {
  user: SessionUser | null;
  loading: boolean;
};

let state: AuthState = { user: null, loading: true };
const listeners = new Set<AuthListener>();
let hydratePromise: Promise<SessionUser | null> | null = null;
let sessionResolved = false;

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

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function hydrateSession(): Promise<SessionUser | null> {
  if (!isInsForgeConfigured || !insforge) {
    state = { user: null, loading: false };
    sessionResolved = true;
    notify();
    return null;
  }

  if (hydratePromise) {
    return hydratePromise;
  }

  if (!sessionResolved) {
    state = { ...state, loading: true };
    notify();
  }

  hydratePromise = (async () => {
    try {
      const { data, error } = await insforge!.auth.getCurrentUser();
      const user = !error && data?.user ? mapUser(data.user) : null;
      state = { user, loading: false };
      sessionResolved = true;
      notify();
      return user;
    } catch {
      state = { user: null, loading: false };
      sessionResolved = true;
      notify();
      return null;
    } finally {
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

export async function signOut(): Promise<void> {
  if (isInsForgeConfigured && insforge) {
    try {
      await insforge.auth.signOut();
    } catch {
      // ignore sign-out errors
    }
  }
  state = { user: null, loading: false };
  sessionResolved = true;
  notify();
}

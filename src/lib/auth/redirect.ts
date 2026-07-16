const RETURN_TO_STORAGE_KEY = 'golazo:authReturnTo';

/**
 * Safe post-auth destinations. Allows `/play` and `/cuenta`, plus query-safe `/play?...`.
 */
export function resolvePostAuthRedirect(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/cuenta';

  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return '/cuenta';
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/cuenta';
  if (decoded.includes('\\') || decoded.includes('\n') || decoded.includes('\r')) return '/cuenta';

  const q = decoded.indexOf('?');
  const hash = decoded.indexOf('#');
  const pathEnd = Math.min(q === -1 ? decoded.length : q, hash === -1 ? decoded.length : hash);
  const path = decoded.slice(0, pathEnd);
  const query = q === -1 ? '' : decoded.slice(q, hash === -1 ? decoded.length : hash);

  if (path === '/cuenta' && !query) return '/cuenta';
  if (path === '/play') {
    if (!query) return '/play';
    if (isSafePlayQuery(query)) return `/play${query}`;
  }

  return '/cuenta';
}

function isSafePlayQuery(query: string): boolean {
  if (!query.startsWith('?') || query.length > 120) return false;
  if (/[<>'"`\s]/.test(query)) return false;
  try {
    const params = new URLSearchParams(query.slice(1));
    for (const [key, value] of params) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(key)) return false;
      if (value.length > 64) return false;
      if (!/^[a-zA-Z0-9._~-]{0,64}$/.test(value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function readReturnToFromSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('returnTo');
  return raw ? resolvePostAuthRedirect(raw) : null;
}

export function persistReturnTo(path: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const safe = resolvePostAuthRedirect(path);
  try {
    sessionStorage.setItem(RETURN_TO_STORAGE_KEY, safe);
  } catch {
    // ignore quota / private mode
  }
}

export function peekReturnTo(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    return stored ? resolvePostAuthRedirect(stored) : null;
  } catch {
    return null;
  }
}

export function consumeReturnTo(fallback = '/cuenta'): string {
  if (typeof sessionStorage === 'undefined') return resolvePostAuthRedirect(fallback);
  try {
    const stored = sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    if (stored) return resolvePostAuthRedirect(stored);
  } catch {
    // ignore
  }
  return resolvePostAuthRedirect(fallback);
}

/** Capture returnTo from the current page URL into sessionStorage (OAuth-safe). */
export function captureReturnToFromPage(): void {
  if (typeof window === 'undefined') return;
  const fromUrl = readReturnToFromSearch(window.location.search);
  if (fromUrl) persistReturnTo(fromUrl);
}

/** Resolve redirect after successful auth (URL param, then sessionStorage). */
export function resolveAuthPageRedirect(): string {
  if (typeof window === 'undefined') return '/cuenta';
  const fromUrl = readReturnToFromSearch(window.location.search);
  if (fromUrl) {
    try {
      sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    } catch {
      // ignore
    }
    return fromUrl;
  }
  return consumeReturnTo('/cuenta');
}

export function withReturnTo(path: string, returnTo: string | null | undefined): string {
  const safe = returnTo ? resolvePostAuthRedirect(returnTo) : null;
  if (!safe || safe === '/cuenta') return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}returnTo=${encodeURIComponent(safe)}`;
}

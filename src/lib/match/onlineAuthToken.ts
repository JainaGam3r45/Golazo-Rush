/**
 * Pure helpers for InsForge bearer tokens (no SDK / session imports).
 */

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

export function accessTokenFromRefreshPayload(
  data: unknown,
  rejectTokens: ReadonlyArray<string | null | undefined> = [],
): string | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec.accessToken !== 'string' || !rec.accessToken.trim()) return null;
  const token = rec.accessToken.trim();
  for (const rejected of rejectTokens) {
    if (rejected && token === rejected) return null;
  }
  return token;
}

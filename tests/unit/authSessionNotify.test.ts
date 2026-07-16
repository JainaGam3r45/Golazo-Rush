import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors the equality gate in src/lib/auth/session.ts so we keep the
 * notify-storm guard covered without bootstrapping InsForge in unit tests.
 */
type AuthState = {
  user: { id: string; email: string; name?: string | null } | null;
  loading: boolean;
  phase: string;
  accessToken: string | null;
  sessionReady: boolean;
  tokenError: string | null;
};

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

describe('auth session notify gate', () => {
  it('treats identical authenticated states as equal (no notify)', () => {
    const a: AuthState = {
      user: { id: 'u1', email: 'a@b.c', name: 'Neo' },
      loading: false,
      phase: 'authenticated',
      accessToken: 'tok',
      sessionReady: true,
      tokenError: null,
    };
    assert.equal(authStatesEqual(a, { ...a }), true);
  });

  it('detects token or user changes', () => {
    const base: AuthState = {
      user: { id: 'u1', email: 'a@b.c', name: null },
      loading: false,
      phase: 'authenticated',
      accessToken: 'tok',
      sessionReady: true,
      tokenError: null,
    };
    assert.equal(authStatesEqual(base, { ...base, accessToken: 'other' }), false);
    assert.equal(authStatesEqual(base, { ...base, user: { ...base.user!, id: 'u2' } }), false);
  });
});

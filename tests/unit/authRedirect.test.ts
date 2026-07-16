import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostAuthRedirect, withReturnTo } from '../../src/lib/auth/redirect.ts';

describe('resolvePostAuthRedirect', () => {
  it('allows /play and /cuenta', () => {
    assert.equal(resolvePostAuthRedirect('/play'), '/play');
    assert.equal(resolvePostAuthRedirect('/cuenta'), '/cuenta');
  });

  it('allows safe /play query strings', () => {
    assert.equal(resolvePostAuthRedirect('/play?mode=online'), '/play?mode=online');
  });

  it('rejects open redirects and unsafe paths', () => {
    assert.equal(resolvePostAuthRedirect('https://evil.example'), '/cuenta');
    assert.equal(resolvePostAuthRedirect('//evil.example'), '/cuenta');
    assert.equal(resolvePostAuthRedirect('/admin'), '/cuenta');
    assert.equal(resolvePostAuthRedirect('/play?x=<script>'), '/cuenta');
  });

  it('builds returnTo links', () => {
    assert.equal(withReturnTo('/login', '/play'), '/login?returnTo=%2Fplay');
    assert.equal(withReturnTo('/login', '/cuenta'), '/login');
  });
});

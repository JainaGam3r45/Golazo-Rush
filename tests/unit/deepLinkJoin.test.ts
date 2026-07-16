import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideDeepLinkJoin } from '../../src/lib/match/deepLinkJoin.ts';
import { dmChannelForPair } from '../../src/lib/realtime/channels.ts';
import { isValidRoomCode } from '../../src/lib/match/roomRules.ts';

describe('decideDeepLinkJoin', () => {
  const base = {
    code: 'ABC234',
    codeValid: true,
    sessionReady: true,
    hasUser: true,
    hasToken: true,
    alreadyTried: false,
    busy: false,
    inLobby: false,
    pendingRoomCode: null as string | null,
  };

  it('waits until session is ready', () => {
    assert.deepEqual(decideDeepLinkJoin({ ...base, sessionReady: false }), { action: 'wait' });
  });

  it('asks guests to sign in', () => {
    assert.deepEqual(decideDeepLinkJoin({ ...base, hasUser: false }), { action: 'guest' });
    assert.deepEqual(decideDeepLinkJoin({ ...base, hasToken: false }), { action: 'guest' });
  });

  it('joins when authenticated and idle', () => {
    assert.deepEqual(decideDeepLinkJoin(base), { action: 'join' });
  });

  it('resumes when pending room matches the link', () => {
    assert.deepEqual(decideDeepLinkJoin({ ...base, pendingRoomCode: 'ABC234' }), { action: 'resume' });
  });

  it('blocks when already in another room', () => {
    assert.deepEqual(decideDeepLinkJoin({ ...base, pendingRoomCode: 'ZZZZZZ' }), {
      action: 'blocked',
      reason: 'other_room',
    });
  });

  it('rejects invalid codes', () => {
    assert.equal(isValidRoomCode('abc'), false);
    assert.deepEqual(
      decideDeepLinkJoin({ ...base, code: 'BAD!!!', codeValid: false }),
      { action: 'blocked', reason: 'invalid_code' },
    );
  });
});

describe('dmChannelForPair', () => {
  it('sorts ids so both peers share one channel', () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    assert.equal(dmChannelForPair(a, b), `dm:${a}:${b}`);
    assert.equal(dmChannelForPair(b, a), `dm:${a}:${b}`);
  });
});

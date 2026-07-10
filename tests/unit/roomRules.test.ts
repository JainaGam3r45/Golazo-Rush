import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canJoinRoom,
  canStartRoom,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeChatMessage,
  teamsConflict,
  wouldClearReadyOnLoadoutChange,
} from '../../src/lib/match/roomRules.ts';

describe('room code', () => {
  it('normalizes and validates codes', () => {
    assert.equal(normalizeRoomCode(' ab23cd '), 'AB23CD');
    assert.equal(isValidRoomCode('AB23CD'), true);
    assert.equal(isValidRoomCode('abc'), false);
    assert.equal(isValidRoomCode('AB1OIL'), false);
  });
});

describe('join rules', () => {
  it('rejects missing room', () => {
    assert.deepEqual(
      canJoinRoom({
        found: false,
        status: 'waiting',
        expired: false,
        activeCount: 0,
        alreadyInAnyRoom: false,
        teamTaken: false,
      }),
      { ok: false, code: 'ROOM_NOT_FOUND' },
    );
  });

  it('rejects third player', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'configuring',
        expired: false,
        activeCount: 2,
        alreadyInAnyRoom: false,
        teamTaken: false,
      }),
      { ok: false, code: 'ROOM_FULL' },
    );
  });

  it('rejects user already in another room', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'waiting',
        expired: false,
        activeCount: 1,
        alreadyInAnyRoom: true,
        teamTaken: false,
      }),
      { ok: false, code: 'ALREADY_IN_ROOM' },
    );
  });
});

describe('loadout ready', () => {
  it('clears ready when team changes', () => {
    assert.equal(
      wouldClearReadyOnLoadoutChange(
        { teamId: 'brasil', formationId: '4-4-2', ready: true },
        { teamId: 'argentina' },
      ),
      true,
    );
  });

  it('detects identical teams', () => {
    assert.equal(teamsConflict('brasil', 'brasil'), true);
    assert.equal(teamsConflict('brasil', 'argentina'), false);
  });
});

describe('start rules', () => {
  it('blocks non-host and incomplete ready', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'ready',
        playerCount: 2,
        readyCount: 2,
        distinctTeams: 2,
        requesterIsHost: false,
      }),
      { ok: false, code: 'NOT_HOST' },
    );

    assert.deepEqual(
      canStartRoom({
        status: 'configuring',
        playerCount: 2,
        readyCount: 1,
        distinctTeams: 2,
        requesterIsHost: true,
      }),
      { ok: false, code: 'NOT_READY' },
    );
  });

  it('allows idempotent start when already starting', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'starting',
        playerCount: 2,
        readyCount: 2,
        distinctTeams: 2,
        requesterIsHost: true,
      }),
      { ok: true },
    );
  });

  it('blocks double-start from non-ready', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'waiting',
        playerCount: 1,
        readyCount: 0,
        distinctTeams: 1,
        requesterIsHost: true,
      }),
      { ok: false, code: 'NOT_READY' },
    );
  });
});

describe('chat sanitize', () => {
  it('rejects empty and strips angle brackets', () => {
    assert.deepEqual(sanitizeChatMessage('   '), { ok: false, code: 'EMPTY_MESSAGE' });
    assert.deepEqual(sanitizeChatMessage('<b>hola</b>'), { ok: true, body: 'bhola/b' });
  });

  it('rejects oversized messages', () => {
    assert.deepEqual(sanitizeChatMessage('x'.repeat(201)), { ok: false, code: 'MESSAGE_TOO_LONG' });
  });
});

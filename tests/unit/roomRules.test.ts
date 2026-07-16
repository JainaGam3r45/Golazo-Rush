import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canClaimSeat,
  canJoinRoom,
  canStartRoom,
  isValidRoomCode,
  leaveRoomUserMessage,
  normalizeRoomCode,
  resolveLeaveRoomOutcome,
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

  it('rejects fifth player', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'configuring',
        expired: false,
        activeCount: 4,
        alreadyInAnyRoom: false,
        teamTaken: false,
      }),
      { ok: false, code: 'ROOM_FULL' },
    );
  });

  it('allows third player when under capacity', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'configuring',
        expired: false,
        activeCount: 2,
        alreadyInAnyRoom: false,
        teamTaken: false,
      }),
      { ok: true },
    );
  });

  it('rejects third on a full side', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'configuring',
        expired: false,
        activeCount: 2,
        alreadyInAnyRoom: false,
        teamTaken: false,
        sideCount: 2,
      }),
      { ok: false, code: 'SIDE_FULL' },
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

  it('allows host start with one ready human when bots are allowed', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'ready',
        playerCount: 1,
        readyCount: 1,
        distinctTeams: 1,
        requesterIsHost: true,
        allowBots: true,
      }),
      { ok: true },
    );
  });

  it('blocks one-human start when bots are disabled', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'ready',
        playerCount: 1,
        readyCount: 1,
        distinctTeams: 1,
        requesterIsHost: true,
        allowBots: false,
      }),
      { ok: false, code: 'NEED_OPPONENT' },
    );
  });

  it('allows host start with four ready humans', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'ready',
        playerCount: 4,
        readyCount: 4,
        distinctTeams: 2,
        requesterIsHost: true,
        allowBots: true,
        sidesWithHumans: 2,
      }),
      { ok: true },
    );
  });

  it('allows same-side duo vs bots when bots enabled', () => {
    assert.deepEqual(
      canStartRoom({
        status: 'ready',
        playerCount: 2,
        readyCount: 2,
        distinctTeams: 1,
        requesterIsHost: true,
        allowBots: true,
        sidesWithHumans: 1,
      }),
      { ok: true },
    );
  });
});

describe('claim seat rules', () => {
  it('blocks spectators and taken seats', () => {
    assert.deepEqual(
      canClaimSeat({
        status: 'waiting',
        isPlayer: false,
        seatTakenByOther: false,
        sideFull: false,
        fieldSlot: 0,
      }),
      { ok: false, code: 'SPECTATOR_READONLY' },
    );
    assert.deepEqual(
      canClaimSeat({
        status: 'waiting',
        isPlayer: true,
        seatTakenByOther: true,
        sideFull: false,
        fieldSlot: 1,
      }),
      { ok: false, code: 'SEAT_TAKEN' },
    );
  });
});

describe('spectator join rules', () => {
  it('allows spectator when player seats are full', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'ready',
        expired: false,
        activeCount: 4,
        alreadyInAnyRoom: false,
        teamTaken: false,
        asSpectator: true,
        spectatorCount: 1,
      }),
      { ok: true },
    );
  });

  it('allows spectator late join while playing', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'playing',
        expired: false,
        activeCount: 2,
        alreadyInAnyRoom: false,
        teamTaken: false,
        asSpectator: true,
        spectatorCount: 0,
      }),
      { ok: true },
    );
  });

  it('blocks spectator when cap reached', () => {
    assert.deepEqual(
      canJoinRoom({
        found: true,
        status: 'playing',
        expired: false,
        activeCount: 2,
        alreadyInAnyRoom: false,
        teamTaken: false,
        asSpectator: true,
        spectatorCount: 8,
      }),
      { ok: false, code: 'ROOM_FULL' },
    );
  });
});

describe('leave mid-match rules', () => {
  it('does not cancel mid-match when another player remains', () => {
    assert.deepEqual(
      resolveLeaveRoomOutcome({
        role: 'player',
        status: 'playing',
        remainingPlayersAfterLeave: 1,
        leaverIsHost: true,
      }),
      { cancelRoom: false, transferHost: true, outcome: 'left' },
    );
    assert.equal(leaveRoomUserMessage('left'), 'Saliste de la partida');
  });

  it('cancels mid-match only when zero players remain', () => {
    assert.deepEqual(
      resolveLeaveRoomOutcome({
        role: 'player',
        status: 'starting',
        remainingPlayersAfterLeave: 0,
        leaverIsHost: false,
      }),
      { cancelRoom: true, transferHost: false, outcome: 'cancelled' },
    );
    assert.equal(leaveRoomUserMessage('cancelled'), 'La sala se canceló');
  });

  it('spectators never cancel the room', () => {
    assert.deepEqual(
      resolveLeaveRoomOutcome({
        role: 'spectator',
        status: 'playing',
        remainingPlayersAfterLeave: 0,
        leaverIsHost: false,
      }),
      { cancelRoom: false, transferHost: false, outcome: 'spectator_left' },
    );
  });

  it('lobby host leave still cancels', () => {
    assert.deepEqual(
      resolveLeaveRoomOutcome({
        role: 'player',
        status: 'ready',
        remainingPlayersAfterLeave: 1,
        leaverIsHost: true,
      }),
      { cancelRoom: true, transferHost: false, outcome: 'cancelled' },
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

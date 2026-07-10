import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOBBY_STALE_MS,
  deriveOnlineUiState,
  needsAbandonConfirm,
  activeRoomBadgeVisible,
} from '../../src/lib/match/onlineUiState.ts';
import { formatModeLabel } from '../../src/lib/match/formats.ts';

describe('onlineUiState', () => {
  it('uses an 8-minute lobby stale TTL', () => {
    assert.equal(LOBBY_STALE_MS, 8 * 60 * 1000);
  });

  it('asks confirm only for starting/playing abandon', () => {
    assert.equal(needsAbandonConfirm('waiting'), false);
    assert.equal(needsAbandonConfirm('ready'), false);
    assert.equal(needsAbandonConfirm('starting'), true);
    assert.equal(needsAbandonConfirm('playing'), true);
  });

  it('maps guest and hydrating phases', () => {
    assert.equal(
      deriveOnlineUiState({
        sessionPhase: 'hydrating',
        hasToken: false,
        checkingActive: false,
        room: null,
        inLobby: false,
        busyAction: null,
        matchConnecting: false,
        matchActive: false,
        errorKind: null,
      }),
      'hydratingSession',
    );
    assert.equal(
      deriveOnlineUiState({
        sessionPhase: 'guest',
        hasToken: false,
        checkingActive: false,
        room: null,
        inLobby: false,
        busyAction: null,
        matchConnecting: false,
        matchActive: false,
        errorKind: null,
      }),
      'guest',
    );
  });

  it('prefers active room over idle create/join', () => {
    const room = { id: 'r1', code: 'ABC234', status: 'waiting' } as never;
    assert.equal(
      deriveOnlineUiState({
        sessionPhase: 'authenticated',
        hasToken: true,
        checkingActive: false,
        room,
        inLobby: false,
        busyAction: null,
        matchConnecting: false,
        matchActive: false,
        errorKind: null,
      }),
      'activeRoom',
    );
    assert.equal(activeRoomBadgeVisible(room), true);
  });

  it('shows lobby when resumed', () => {
    const room = { id: 'r1', code: 'ABC234', status: 'configuring' } as never;
    assert.equal(
      deriveOnlineUiState({
        sessionPhase: 'authenticated',
        hasToken: true,
        checkingActive: false,
        room,
        inLobby: true,
        busyAction: null,
        matchConnecting: false,
        matchActive: false,
        errorKind: null,
      }),
      'roomLobby',
    );
  });
});

describe('formatModeLabel', () => {
  it('uses Contra bots copy for public labels', () => {
    assert.equal(formatModeLabel('5v5'), '5v5 Contra bots');
    assert.match(formatModeLabel('11v11'), /Contra bots/);
    assert.equal(formatModeLabel('5v5').includes('vs CPU'), false);
  });
});

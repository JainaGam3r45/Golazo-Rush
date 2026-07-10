import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapOnlineUiToShell, shellStateLabel } from '../../src/lib/match/shellState.ts';
import { healthUrlFromGameServer } from '../../src/lib/match/serverHealth.ts';
import {
  setGameplayKeysSuspended,
  areGameplayKeysSuspended,
  clearGameplayKeysSuspended,
  registerCpuGame,
  registerOnlineGame,
  getActivePhaserGame,
} from '../../src/lib/match/inputSuspend.ts';
import { toHttpUrl } from '../../src/lib/match/onlineProtocol.ts';

describe('shellState', () => {
  it('maps room lobby to shell room without overriding match', () => {
    assert.equal(mapOnlineUiToShell('roomLobby', 'hub'), 'room');
    assert.equal(mapOnlineUiToShell('roomLobby', 'match'), 'match');
    assert.equal(mapOnlineUiToShell('authenticatedIdle', 'entry'), 'entry');
  });

  it('labels shell states in Spanish', () => {
    assert.equal(shellStateLabel('hub'), 'Menú');
    assert.equal(shellStateLabel('match'), 'Partido');
  });
});

describe('serverHealth', () => {
  it('builds health URL via toHttpUrl for wss bases', () => {
    const url = healthUrlFromGameServer('wss://game.example.com');
    assert.equal(url, 'https://game.example.com/health');
    assert.equal(toHttpUrl('wss://game.example.com'), 'https://game.example.com');
  });
});

describe('inputSuspend', () => {
  it('scopes suspension per game owner', () => {
    const cpu = { id: 'cpu' };
    const online = { id: 'online' };
    registerCpuGame(cpu);
    registerOnlineGame(null);
    setGameplayKeysSuspended(cpu, true);
    assert.equal(areGameplayKeysSuspended(cpu), true);
    assert.equal(areGameplayKeysSuspended(online), false);
    clearGameplayKeysSuspended(cpu);
    assert.equal(areGameplayKeysSuspended(cpu), false);
    registerCpuGame(null);
    assert.equal(getActivePhaserGame(), null);
  });

  it('does not leak online suspend into cpu game', () => {
    const cpu = { id: 'cpu2' };
    const online = { id: 'online2' };
    registerOnlineGame(online);
    setGameplayKeysSuspended(online, true);
    registerCpuGame(cpu);
    assert.equal(areGameplayKeysSuspended(cpu), false);
    assert.equal(areGameplayKeysSuspended(online), true);
    clearGameplayKeysSuspended(online);
    registerOnlineGame(null);
    registerCpuGame(null);
  });
});

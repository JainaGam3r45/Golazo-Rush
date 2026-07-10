/**
 * Per-game input suspension. Keyed by Phaser.Game so Contra bots and Online
 * never share a sticky flag across match modes.
 */

type SuspendOwner = object;

const suspended = new WeakMap<SuspendOwner, boolean>();

let cpuGameRef: SuspendOwner | null = null;
let onlineGameRef: SuspendOwner | null = null;

export function setGameplayKeysSuspended(owner: SuspendOwner, value: boolean): void {
  suspended.set(owner, value);
}

export function areGameplayKeysSuspended(owner: SuspendOwner | null | undefined): boolean {
  if (!owner) return false;
  return suspended.get(owner) === true;
}

export function clearGameplayKeysSuspended(owner: SuspendOwner): void {
  suspended.delete(owner);
}

export function registerCpuGame(game: SuspendOwner | null): void {
  if (cpuGameRef && cpuGameRef !== game) {
    clearGameplayKeysSuspended(cpuGameRef);
  }
  cpuGameRef = game;
}

export function registerOnlineGame(game: SuspendOwner | null): void {
  if (onlineGameRef && onlineGameRef !== game) {
    clearGameplayKeysSuspended(onlineGameRef);
  }
  onlineGameRef = game;
}

/** Active match game for the current path (online preferred when both somehow exist). */
export function getActivePhaserGame(): SuspendOwner | null {
  return onlineGameRef ?? cpuGameRef;
}

export function setActiveGameSuspended(value: boolean): void {
  const game = getActivePhaserGame();
  if (!game) return;
  setGameplayKeysSuspended(game, value);
}

export function isActiveGameSuspended(): boolean {
  return areGameplayKeysSuspended(getActivePhaserGame());
}

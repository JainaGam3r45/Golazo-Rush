import type { RoomSnapshot, RoomStatus } from './roomTypes';

export type OnlineUiState =
  | 'hydratingSession'
  | 'guest'
  | 'authenticatedIdle'
  | 'checkingActiveRoom'
  | 'activeRoom'
  | 'creatingRoom'
  | 'joiningRoom'
  | 'roomLobby'
  | 'connectingMatch'
  | 'matchActive'
  | 'recoverableError'
  | 'fatalError';

export const LOBBY_STALE_MS = 8 * 60 * 1000;

export function needsAbandonConfirm(status: RoomStatus | string | undefined): boolean {
  return status === 'starting' || status === 'playing';
}

export function isLobbyStatus(status: RoomStatus | string | undefined): boolean {
  return status === 'waiting' || status === 'configuring' || status === 'ready';
}

export function deriveOnlineUiState(input: {
  sessionPhase: string;
  hasToken: boolean;
  checkingActive: boolean;
  room: RoomSnapshot | null;
  inLobby: boolean;
  busyAction: 'create' | 'join' | null;
  matchConnecting: boolean;
  matchActive: boolean;
  errorKind: 'recoverable' | 'fatal' | null;
}): OnlineUiState {
  if (input.sessionPhase === 'hydrating' || input.sessionPhase === 'refreshing') {
    return 'hydratingSession';
  }
  if (input.sessionPhase === 'guest') return 'guest';
  if (input.errorKind === 'fatal') return 'fatalError';
  if (input.errorKind === 'recoverable' && !input.room && !input.inLobby) {
    return 'recoverableError';
  }
  if (input.matchActive) return 'matchActive';
  if (input.matchConnecting) return 'connectingMatch';
  if (input.inLobby && input.room) return 'roomLobby';
  if (input.checkingActive) return 'checkingActiveRoom';
  if (input.room && !input.inLobby) return 'activeRoom';
  if (input.busyAction === 'create') return 'creatingRoom';
  if (input.busyAction === 'join') return 'joiningRoom';
  if (
    input.sessionPhase === 'authenticated' ||
    input.sessionPhase === 'expired' ||
    input.sessionPhase === 'error'
  ) {
    if (!input.hasToken && input.sessionPhase !== 'authenticated') {
      return 'recoverableError';
    }
    if (!input.hasToken) return 'recoverableError';
    return 'authenticatedIdle';
  }
  return 'hydratingSession';
}

export function activeRoomBadgeVisible(room: RoomSnapshot | null): boolean {
  return Boolean(room?.id);
}

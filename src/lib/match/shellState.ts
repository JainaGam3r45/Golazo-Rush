import type { OnlineUiState } from './onlineUiState.ts';

/** Visible shell screen — separate from match mode (cpu|online) and room data. */
export type ShellState =
  | 'boot'
  | 'entry'
  | 'hub'
  | 'room'
  | 'connectingMatch'
  | 'match'
  | 'results'
  | 'recoverableError';

export type MatchMode = 'cpu' | 'online' | null;

export type HubSubview = 'cards' | 'cpuSelect' | 'cpuPreview' | 'online';

export function mapOnlineUiToShell(online: OnlineUiState, current: ShellState): ShellState {
  if (current === 'entry' || current === 'boot') return current;
  if (current === 'match' || current === 'results') return current;

  switch (online) {
    case 'hydratingSession':
    case 'checkingActiveRoom':
      return current === 'hub' || current === 'room' ? current : 'hub';
    case 'guest':
    case 'authenticatedIdle':
    case 'activeRoom':
    case 'creatingRoom':
    case 'joiningRoom':
      return 'hub';
    case 'roomLobby':
      return 'room';
    case 'connectingMatch':
      return 'connectingMatch';
    case 'matchActive':
      return 'match';
    case 'recoverableError':
      return 'recoverableError';
    case 'fatalError':
      return 'recoverableError';
    default:
      return current;
  }
}

export function shellStateLabel(state: ShellState): string {
  switch (state) {
    case 'boot':
      return 'Cargando…';
    case 'entry':
      return 'Entrada';
    case 'hub':
      return 'Menú';
    case 'room':
      return 'Sala';
    case 'connectingMatch':
      return 'Conectando…';
    case 'match':
      return 'Partido';
    case 'results':
      return 'Resultado';
    case 'recoverableError':
      return 'Error';
    default:
      return '';
  }
}

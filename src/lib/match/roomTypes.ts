import type { FormationId } from './formations';

export type RoomStatus =
  | 'waiting'
  | 'configuring'
  | 'ready'
  | 'starting'
  | 'playing'
  | 'finished'
  | 'cancelled';

export type RoomSlot = 'home' | 'away';

export type RoomPlayerSnapshot = {
  id: string;
  userId: string;
  slot: RoomSlot;
  teamId: string | null;
  formationId: FormationId;
  ready: boolean;
  joinedAt: string;
  lastSeenAt: string;
  displayName: string | null;
  username: string | null;
};

export type RoomSnapshot = {
  id: string;
  code: string;
  hostUserId: string;
  status: RoomStatus;
  formatId: string;
  durationSeconds: number;
  matchId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  players: RoomPlayerSnapshot[];
};

export type RoomChatMessage = {
  roomId: string;
  userId: string;
  body: string;
  createdAt: string;
};

export type RoomStartingPayload = {
  roomId: string;
  countdownSeconds: number;
  status: 'starting';
};

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  waiting: 'Esperando rival',
  configuring: 'Configurando partido',
  ready: 'Ambos listos',
  starting: 'El partido comienza en…',
  playing: 'En juego',
  finished: 'Partido finalizado',
  cancelled: 'Sala cancelada',
};

export function roomStatusLabel(status: RoomStatus, opts?: { disconnected?: boolean }): string {
  if (opts?.disconnected) return 'Jugador desconectado';
  if (status === 'ready') return 'Ambos listos';
  if (status === 'configuring') return 'Esperando confirmación';
  return ROOM_STATUS_LABELS[status];
}

/** @deprecated kept for any leftover imports during Phase A */
export type RoomFormationState =
  | 'waiting_opponent_pick'
  | 'formation_confirmed'
  | 'ready_to_play';

export type RoomPlayer = {
  userId: string;
  teamId: string;
  proposedFormationId?: FormationId;
  confirmedFormationId?: FormationId;
};

export type MatchRoom = {
  id: string;
  players: RoomPlayer[];
  formationState: RoomFormationState;
};

export const ROOM_FORMATION_LABELS: Record<RoomFormationState, string> = {
  waiting_opponent_pick: 'Esperando elección del otro jugador',
  formation_confirmed: 'Formación confirmada',
  ready_to_play: 'Listo para jugar',
};

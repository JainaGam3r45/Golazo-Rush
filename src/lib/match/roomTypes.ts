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

export type RoomMemberRole = 'player' | 'spectator';

/** Claimable outfield indices for human seats (UI uses 0–1; schema allows 0–3). */
export const ROOM_FIELD_SLOTS = [0, 1] as const;
export type RoomFieldSlot = (typeof ROOM_FIELD_SLOTS)[number];

export const MAX_HUMANS_PER_SIDE = 2;
export const MAX_HUMANS_TOTAL = 4;

export type RoomPlayerSnapshot = {
  id: string;
  userId: string;
  slot: RoomSlot | null;
  /** Outfield pitch index 0–3; null for spectators. */
  fieldSlot?: number | null;
  role: RoomMemberRole;
  teamId: string | null;
  formationId: FormationId;
  lineup?: Array<{ nx: number; ny: number; role?: string }> | null;
  ready: boolean;
  joinedAt: string;
  lastSeenAt: string;
  displayName: string | null;
  username: string | null;
};

export type RoomChatMessage = {
  id?: string;
  roomId: string;
  userId: string;
  body: string;
  createdAt: string;
  displayName?: string | null;
  username?: string | null;
};

export type RoomSnapshot = {
  id: string;
  code: string;
  hostUserId: string;
  status: RoomStatus;
  formatId: string;
  durationSeconds: number;
  /** When true, host may start with ≥1 ready human; empty seats = bots. */
  allowBots?: boolean;
  matchId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  players: RoomPlayerSnapshot[];
  /** Last messages when rejoining; filled by room_snapshot. */
  chatHistory?: RoomChatMessage[];
};

export type RoomStartingPayload = {
  roomId: string;
  countdownSeconds: number;
  status: 'starting';
  allowBots?: boolean;
};

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  waiting: 'Esperando rival',
  configuring: 'Configurando partido',
  ready: 'Listo para iniciar',
  starting: 'El partido comienza en…',
  playing: 'En juego',
  finished: 'Partido finalizado',
  cancelled: 'Sala cancelada',
};

export function roomStatusLabel(
  status: RoomStatus,
  opts?: { disconnected?: boolean; allowBots?: boolean; playerCount?: number },
): string {
  if (opts?.disconnected) return 'Jugador desconectado';
  if (status === 'ready') {
    if (opts?.allowBots && (opts.playerCount ?? 2) < 2) return 'Listo — puedes jugar vs bots';
    return 'Listos para iniciar';
  }
  if (status === 'waiting' && opts?.allowBots) return 'Esperando rival o juega vs bots';
  if (status === 'configuring') return 'Esperando confirmación';
  return ROOM_STATUS_LABELS[status];
}

export function roomPlayers(room: RoomSnapshot): RoomPlayerSnapshot[] {
  return room.players.filter((p) => (p.role ?? 'player') === 'player');
}

export function roomSpectators(room: RoomSnapshot): RoomPlayerSnapshot[] {
  return room.players.filter((p) => p.role === 'spectator');
}

export function playerAtSeat(
  players: RoomPlayerSnapshot[],
  side: RoomSlot,
  fieldSlot: number,
): RoomPlayerSnapshot | undefined {
  return players.find(
    (p) => (p.role ?? 'player') === 'player' && p.slot === side && (p.fieldSlot ?? 0) === fieldSlot,
  );
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

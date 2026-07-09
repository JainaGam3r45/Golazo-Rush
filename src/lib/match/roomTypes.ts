import type { FormationId } from './formations';

/**
 * Tipos para salas multijugador futuras — sin lógica online en esta fase.
 */

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
  // Futuro: mismo equipo → acordar 1 formación; equipos opuestos → cada uno la suya
};

export const ROOM_FORMATION_LABELS: Record<RoomFormationState, string> = {
  waiting_opponent_pick: 'Esperando elección del otro jugador',
  formation_confirmed: 'Formación confirmada',
  ready_to_play: 'Listo para jugar',
};

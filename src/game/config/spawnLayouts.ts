import type { FormationId } from '../../lib/match/formations';
import { PITCH_HEIGHT, PITCH_WIDTH } from './pitch';

export type FieldRole = 'def' | 'mid' | 'fwd';
export type PlayerSide = 'home' | 'away';

export type SpawnAnchor = {
  role: FieldRole;
  slot: number;
  x: number;
  y: number;
};

type NormalizedAnchor = { role: FieldRole; slot: number; nx: number; ny: number };

const FORMATION_ANCHORS: Record<FormationId, NormalizedAnchor[]> = {
  '4-4-2': [
    { role: 'def', slot: 0, nx: 0.2, ny: 0.3 },
    { role: 'def', slot: 1, nx: 0.2, ny: 0.7 },
    { role: 'mid', slot: 2, nx: 0.34, ny: 0.38 },
    { role: 'mid', slot: 3, nx: 0.34, ny: 0.62 },
  ],
  '4-3-3': [
    { role: 'def', slot: 0, nx: 0.18, ny: 0.5 },
    { role: 'mid', slot: 1, nx: 0.32, ny: 0.5 },
    { role: 'fwd', slot: 2, nx: 0.44, ny: 0.3 },
    { role: 'fwd', slot: 3, nx: 0.44, ny: 0.7 },
  ],
  '3-5-2': [
    { role: 'def', slot: 0, nx: 0.18, ny: 0.5 },
    { role: 'mid', slot: 1, nx: 0.3, ny: 0.26 },
    { role: 'mid', slot: 2, nx: 0.32, ny: 0.5 },
    { role: 'mid', slot: 3, nx: 0.3, ny: 0.74 },
  ],
  '4-2-3-1': [
    { role: 'def', slot: 0, nx: 0.2, ny: 0.32 },
    { role: 'def', slot: 1, nx: 0.2, ny: 0.68 },
    { role: 'mid', slot: 2, nx: 0.32, ny: 0.5 },
    { role: 'fwd', slot: 3, nx: 0.4, ny: 0.5 },
  ],
};

function mirrorX(nx: number, side: PlayerSide): number {
  if (side === 'home') {
    return Math.round(nx * PITCH_WIDTH);
  }
  return Math.round((1 - nx) * PITCH_WIDTH);
}

export function getFieldAnchors(formationId: FormationId, side: PlayerSide): SpawnAnchor[] {
  const anchors = FORMATION_ANCHORS[formationId];
  return anchors.map((anchor) => ({
    role: anchor.role,
    slot: anchor.slot,
    x: mirrorX(anchor.nx, side),
    y: Math.round(anchor.ny * PITCH_HEIGHT),
  }));
}

export function getKickoffBallPosition(concedingSide: PlayerSide): { x: number; y: number } {
  const offset = concedingSide === 'home' ? -35 : 35;
  return {
    x: PITCH_WIDTH / 2 + offset,
    y: PITCH_HEIGHT / 2,
  };
}

export const FIELD_BOTS_PER_TEAM = 4;
export const HUMAN_TEAM_FIELD_BOTS = 3;

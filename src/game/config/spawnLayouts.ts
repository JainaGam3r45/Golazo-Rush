import type { FormationId } from '../../lib/match/formations';
import type { MatchFormatId } from '../../lib/match/formats';
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

/** 5v5 arcade: 4 outfield (human replaces slot 0 on their side). */
const FORMATION_ANCHORS_5V5: Record<FormationId, NormalizedAnchor[]> = {
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

/**
 * 11v11: 10 outfield with real roles.
 * Slot order is stable; human replaces the first midfielder-ish slot (slot 0) on their side.
 */
const FORMATION_ANCHORS_11V11: Record<FormationId, NormalizedAnchor[]> = {
  '4-4-2': [
    { role: 'mid', slot: 0, nx: 0.38, ny: 0.38 },
    { role: 'def', slot: 1, nx: 0.16, ny: 0.18 },
    { role: 'def', slot: 2, nx: 0.18, ny: 0.38 },
    { role: 'def', slot: 3, nx: 0.18, ny: 0.62 },
    { role: 'def', slot: 4, nx: 0.16, ny: 0.82 },
    { role: 'mid', slot: 5, nx: 0.38, ny: 0.18 },
    { role: 'mid', slot: 6, nx: 0.38, ny: 0.62 },
    { role: 'mid', slot: 7, nx: 0.38, ny: 0.82 },
    { role: 'fwd', slot: 8, nx: 0.52, ny: 0.36 },
    { role: 'fwd', slot: 9, nx: 0.52, ny: 0.64 },
  ],
  '4-3-3': [
    { role: 'mid', slot: 0, nx: 0.36, ny: 0.5 },
    { role: 'def', slot: 1, nx: 0.16, ny: 0.18 },
    { role: 'def', slot: 2, nx: 0.18, ny: 0.38 },
    { role: 'def', slot: 3, nx: 0.18, ny: 0.62 },
    { role: 'def', slot: 4, nx: 0.16, ny: 0.82 },
    { role: 'mid', slot: 5, nx: 0.34, ny: 0.28 },
    { role: 'mid', slot: 6, nx: 0.34, ny: 0.72 },
    { role: 'fwd', slot: 7, nx: 0.5, ny: 0.22 },
    { role: 'fwd', slot: 8, nx: 0.52, ny: 0.5 },
    { role: 'fwd', slot: 9, nx: 0.5, ny: 0.78 },
  ],
  '3-5-2': [
    { role: 'mid', slot: 0, nx: 0.36, ny: 0.5 },
    { role: 'def', slot: 1, nx: 0.18, ny: 0.28 },
    { role: 'def', slot: 2, nx: 0.16, ny: 0.5 },
    { role: 'def', slot: 3, nx: 0.18, ny: 0.72 },
    { role: 'mid', slot: 4, nx: 0.32, ny: 0.14 },
    { role: 'mid', slot: 5, nx: 0.34, ny: 0.32 },
    { role: 'mid', slot: 6, nx: 0.34, ny: 0.68 },
    { role: 'mid', slot: 7, nx: 0.32, ny: 0.86 },
    { role: 'fwd', slot: 8, nx: 0.5, ny: 0.38 },
    { role: 'fwd', slot: 9, nx: 0.5, ny: 0.62 },
  ],
  '4-2-3-1': [
    { role: 'mid', slot: 0, nx: 0.4, ny: 0.5 },
    { role: 'def', slot: 1, nx: 0.16, ny: 0.18 },
    { role: 'def', slot: 2, nx: 0.18, ny: 0.38 },
    { role: 'def', slot: 3, nx: 0.18, ny: 0.62 },
    { role: 'def', slot: 4, nx: 0.16, ny: 0.82 },
    { role: 'mid', slot: 5, nx: 0.3, ny: 0.38 },
    { role: 'mid', slot: 6, nx: 0.3, ny: 0.62 },
    { role: 'mid', slot: 7, nx: 0.4, ny: 0.24 },
    { role: 'mid', slot: 8, nx: 0.4, ny: 0.76 },
    { role: 'fwd', slot: 9, nx: 0.52, ny: 0.5 },
  ],
};

function mirrorX(nx: number, side: PlayerSide): number {
  if (side === 'home') {
    return Math.round(nx * PITCH_WIDTH);
  }
  return Math.round((1 - nx) * PITCH_WIDTH);
}

function anchorsForFormat(formatId: MatchFormatId): Record<FormationId, NormalizedAnchor[]> {
  return formatId === '11v11' ? FORMATION_ANCHORS_11V11 : FORMATION_ANCHORS_5V5;
}

export function getFieldAnchors(
  formationId: FormationId,
  side: PlayerSide,
  formatId: MatchFormatId = '5v5',
): SpawnAnchor[] {
  const anchors = anchorsForFormat(formatId)[formationId];
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

export function fieldPlayersPerSide(formatId: MatchFormatId): number {
  return formatId === '11v11' ? 10 : 4;
}

export function playerVisualScale(formatId: MatchFormatId): number {
  return formatId === '11v11' ? 0.82 : 1;
}

export const FIELD_BOTS_PER_TEAM = 4;
export const HUMAN_TEAM_FIELD_BOTS = 3;

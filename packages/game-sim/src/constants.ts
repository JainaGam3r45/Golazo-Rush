import type { FormationId, Side, FieldRole, Vec2 } from './types.ts';

export const PITCH_WIDTH = 1100;
export const PITCH_HEIGHT = 650;
export const PITCH_MARGIN = 28;

export const GOAL_TOP = 247;
export const GOAL_BOTTOM = 403;
export const GOAL_DEPTH = 25;
export const GOAL_CENTER_Y = (GOAL_TOP + GOAL_BOTTOM) / 2;

export const GOALKEEPER_HOME_X = 72;
export const GOALKEEPER_AWAY_X = PITCH_WIDTH - 72;
export const GOALKEEPER_Y_MIN = GOAL_TOP + 12;
export const GOALKEEPER_Y_MAX = GOAL_BOTTOM - 12;

export const PLAYABLE_LEFT = PITCH_MARGIN;
export const PLAYABLE_RIGHT = PITCH_WIDTH - PITCH_MARGIN;
export const PLAYABLE_TOP = PITCH_MARGIN;
export const PLAYABLE_BOTTOM = PITCH_HEIGHT - PITCH_MARGIN;

/** @deprecated Prefer TEAM_SIZE_11V11 — product is 11v11. */
export const TEAM_SIZE_5V5 = 5;
export const TEAM_SIZE_11V11 = 11;
export const FIELD_PLAYERS_PER_TEAM = 10;

export const PLAYER_RADIUS = 12;
export const BALL_RADIUS = 12;

export const PLAYER_SPEED = 220;
export const BOT_SPEED = 187;
export const GK_SPEED = 160;
export const SPRINT_MULTIPLIER = 1.5;
export const SPRINT_DURATION_MS = 800;
export const SPRINT_COOLDOWN_MS = 2000;

export const BALL_DRAG = 140;
export const BALL_MAX_SPEED = 600;
export const BALL_IDLE_SPEED = 45;
export const BALL_BOUNCE = 0.82;

export const KICK_RANGE = 36;
export const KICK_FORCE = 380;
export const CHARGED_KICK_FORCE = 620;
export const KICK_OFFSET = 12;
export const KICK_COOLDOWN_MS = 250;
export const BOT_KICK_COOLDOWN_MS = 400;
export const GK_KICK_COOLDOWN_MS = 350;
export const PASS_COOLDOWN_MS = 450;
export const CLEAR_COOLDOWN_MS = 700;
export const TACKLE_RANGE = 42;
export const TACKLE_COOLDOWN_MS = 900;

export const CONTROL_LERP = 0.25;
export const CONTROL_VELOCITY_BLEND = 0.15;
export const KICKED_DURATION_MS = 350;
export const CONTESTED_MAX_MS = 600;
export const CONTROL_COOLDOWN_MS = 500;

export const GOAL_RESET_PAUSE_MS = 1200;
export const DEFAULT_DURATION_SECONDS = 180;
export const FIXED_DT_CAP_MS = 50;

export const DEFAULT_PRESS = { pressWeight: 1.0, shootDistance: 280, lineHeight: 0.55 };

export const FORMATION_PRESS: Record<FormationId, { pressWeight: number; shootDistance: number; lineHeight: number }> = {
  '4-3-3': { pressWeight: 1.25, shootDistance: 300, lineHeight: 0.72 },
  '4-4-2': { pressWeight: 1.0, shootDistance: 280, lineHeight: 0.55 },
  '3-5-2': { pressWeight: 1.15, shootDistance: 270, lineHeight: 0.65 },
  '4-2-3-1': { pressWeight: 0.85, shootDistance: 260, lineHeight: 0.42 },
};

export type LineupAnchorInput = {
  nx: number;
  ny: number;
  role?: Exclude<FieldRole, 'gk'>;
};

type NormalizedAnchor = { role: Exclude<FieldRole, 'gk'>; slot: number; nx: number; ny: number };

function roleFromNx(nx: number): Exclude<FieldRole, 'gk'> {
  if (nx < 0.28) return 'def';
  if (nx < 0.42) return 'mid';
  return 'fwd';
}

/** Default 11v11 4-4-2 outfield. */
const DEFAULT_LINEUP_11V11: NormalizedAnchor[] = [
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
];

const FORMATION_ANCHORS_11V11: Record<FormationId, NormalizedAnchor[]> = {
  '4-4-2': DEFAULT_LINEUP_11V11,
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

export type SpawnAnchor = {
  role: Exclude<FieldRole, 'gk'>;
  slot: number;
  x: number;
  y: number;
};

function mirrorX(nx: number, side: Side): number {
  return side === 'home' ? Math.round(nx * PITCH_WIDTH) : Math.round((1 - nx) * PITCH_WIDTH);
}

function normalizeCustomLineup(lineup: LineupAnchorInput[] | undefined): NormalizedAnchor[] | null {
  if (!lineup || lineup.length !== FIELD_PLAYERS_PER_TEAM) return null;
  return lineup.map((row, slot) => {
    const nx = Math.min(0.55, Math.max(0.12, Number(row.nx) || 0.35));
    const ny = Math.min(0.92, Math.max(0.08, Number(row.ny) || 0.5));
    const role =
      row.role === 'def' || row.role === 'mid' || row.role === 'fwd' ? row.role : roleFromNx(nx);
    return { role, slot, nx, ny };
  });
}

export function getFieldAnchors(
  formationId: FormationId,
  side: Side,
  customLineup?: LineupAnchorInput[],
): SpawnAnchor[] {
  const custom = normalizeCustomLineup(customLineup);
  const anchors = custom ?? FORMATION_ANCHORS_11V11[formationId] ?? DEFAULT_LINEUP_11V11;
  return anchors.map((anchor) => ({
    role: anchor.role,
    slot: anchor.slot,
    x: mirrorX(anchor.nx, side),
    y: Math.round(anchor.ny * PITCH_HEIGHT),
  }));
}

export function getKickoffBallPosition(concedingSide: Side): Vec2 {
  const offset = concedingSide === 'home' ? -35 : 35;
  return { x: PITCH_WIDTH / 2 + offset, y: PITCH_HEIGHT / 2 };
}

export function clampPlayer(x: number, y: number): Vec2 {
  return {
    x: Math.min(PLAYABLE_RIGHT - 8, Math.max(PLAYABLE_LEFT + 8, x)),
    y: Math.min(PLAYABLE_BOTTOM - 8, Math.max(PLAYABLE_TOP + 8, y)),
  };
}

export function clampBall(x: number, y: number): Vec2 {
  return {
    x: Math.min(PLAYABLE_RIGHT - 4, Math.max(PLAYABLE_LEFT + 4, x)),
    y: Math.min(PLAYABLE_BOTTOM - 4, Math.max(PLAYABLE_TOP + 4, y)),
  };
}

export function clampGkY(y: number): number {
  return Math.min(GOALKEEPER_Y_MAX, Math.max(GOALKEEPER_Y_MIN, y));
}

export function opponentGoalX(side: Side): number {
  return side === 'home' ? PITCH_WIDTH : 0;
}

export function ownGoalX(side: Side): number {
  return side === 'home' ? 0 : PITCH_WIDTH;
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function normalize(x: number, y: number): Vec2 {
  const l = len(x, y) || 1;
  return { x: x / l, y: y / l };
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return len(ax - bx, ay - by);
}

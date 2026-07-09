import {
  GOAL_BOTTOM,
  GOAL_DEPTH,
  GOAL_TOP,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
} from '../config/pitch';

export const PLAYABLE_LEFT = PITCH_MARGIN;
export const PLAYABLE_RIGHT = PITCH_WIDTH - PITCH_MARGIN;
export const PLAYABLE_TOP = PITCH_MARGIN;
export const PLAYABLE_BOTTOM = PITCH_HEIGHT - PITCH_MARGIN;

export const OUT_EDGE_PUSH = 60;
export const SOFT_CLAMP_PAD = 4;

export type OutKind = 'sideline' | 'endline';

export type BallOutResult =
  | { out: false }
  | { out: true; kind: 'sideline'; side: 'top' | 'bottom'; x: number; y: number }
  | { out: true; kind: 'endline'; end: 'home' | 'away'; x: number; y: number };

export function isInGoalMouth(x: number, y: number): boolean {
  if (y < GOAL_TOP || y > GOAL_BOTTOM) return false;
  return x <= GOAL_DEPTH || x >= PITCH_WIDTH - GOAL_DEPTH;
}

export function isBallOut(x: number, y: number): BallOutResult {
  if (isInGoalMouth(x, y)) return { out: false };

  if (y < PLAYABLE_TOP) {
    return { out: true, kind: 'sideline', side: 'top', x, y: PLAYABLE_TOP };
  }
  if (y > PLAYABLE_BOTTOM) {
    return { out: true, kind: 'sideline', side: 'bottom', x, y: PLAYABLE_BOTTOM };
  }
  if (x < PLAYABLE_LEFT) {
    return { out: true, kind: 'endline', end: 'home', x: PLAYABLE_LEFT, y };
  }
  if (x > PLAYABLE_RIGHT) {
    return { out: true, kind: 'endline', end: 'away', x: PLAYABLE_RIGHT, y };
  }
  return { out: false };
}

export function clampToPlayable(
  x: number,
  y: number,
  pad = SOFT_CLAMP_PAD,
): { x: number; y: number } {
  return {
    x: Math.min(PLAYABLE_RIGHT - pad, Math.max(PLAYABLE_LEFT + pad, x)),
    y: Math.min(PLAYABLE_BOTTOM - pad, Math.max(PLAYABLE_TOP + pad, y)),
  };
}

export function clampPlayer(x: number, y: number): { x: number; y: number } {
  return clampToPlayable(x, y, 8);
}

export function clampBallSoft(x: number, y: number): { x: number; y: number } {
  return clampToPlayable(x, y, SOFT_CLAMP_PAD);
}

export function isNearBoundary(x: number, y: number, threshold = OUT_EDGE_PUSH): boolean {
  return (
    x - PLAYABLE_LEFT < threshold ||
    PLAYABLE_RIGHT - x < threshold ||
    y - PLAYABLE_TOP < threshold ||
    PLAYABLE_BOTTOM - y < threshold
  );
}

export function pushTowardPlayableCenter(x: number, y: number): { x: number; y: number } {
  const cx = PITCH_WIDTH / 2;
  const cy = PITCH_HEIGHT / 2;
  let dx = cx - x;
  let dy = cy - y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len;
  dy /= len;
  return { x: dx, y: dy };
}

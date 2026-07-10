import type { Side } from './types.ts';
import { GOAL_BOTTOM, GOAL_DEPTH, GOAL_TOP, PITCH_WIDTH } from './constants.ts';

/** Returns the scoring side, or null if no goal. */
export function detectGoal(x: number, y: number): Side | null {
  if (y < GOAL_TOP || y > GOAL_BOTTOM) return null;
  if (x <= GOAL_DEPTH) return 'away';
  if (x >= PITCH_WIDTH - GOAL_DEPTH) return 'home';
  return null;
}

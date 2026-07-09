import {
  GOAL_CENTER_Y,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_TOP,
  PENALTY_BOX_WIDTH,
  PITCH_MARGIN,
  PITCH_WIDTH,
} from '../config/pitch';

export type PenaltyPhase = 'idle' | 'awarded' | 'stub_reset';

export type PenaltyAward = {
  fouledSide: 'home' | 'away';
  spot: { x: number; y: number };
};

export const PENALTY_SPOT_HOME_X = PITCH_MARGIN + 88;
export const PENALTY_SPOT_AWAY_X = PITCH_WIDTH - PITCH_MARGIN - 88;
export const PENALTY_SPOT_Y = GOAL_CENTER_Y;

export function isInsidePenaltyBox(x: number, y: number, defendingSide: 'home' | 'away'): boolean {
  if (y < PENALTY_BOX_TOP || y > PENALTY_BOX_TOP + PENALTY_BOX_HEIGHT) return false;
  if (defendingSide === 'home') {
    return x >= PITCH_MARGIN && x <= PITCH_MARGIN + PENALTY_BOX_WIDTH;
  }
  return x >= PITCH_WIDTH - PITCH_MARGIN - PENALTY_BOX_WIDTH && x <= PITCH_WIDTH - PITCH_MARGIN;
}

export function getPenaltySpot(fouledSide: 'home' | 'away'): { x: number; y: number } {
  const defendingSide = fouledSide === 'home' ? 'away' : 'home';
  return {
    x: defendingSide === 'home' ? PENALTY_SPOT_HOME_X : PENALTY_SPOT_AWAY_X,
    y: PENALTY_SPOT_Y,
  };
}

export function createPenaltyAward(fouledSide: 'home' | 'away'): PenaltyAward {
  return {
    fouledSide,
    spot: getPenaltySpot(fouledSide),
  };
}

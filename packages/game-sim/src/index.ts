export { createMatch } from './match.ts';
export type { Match } from './match.ts';

export type {
  BallSnapshot,
  BallState,
  FieldRole,
  FormationId,
  MatchConfig,
  MatchPhase,
  MatchSnapshot,
  PlayerInput,
  PlayerKind,
  PlayerSnapshot,
  Side,
  Vec2,
} from './types.ts';

export {
  PITCH_WIDTH,
  PITCH_HEIGHT,
  TEAM_SIZE_5V5,
  TEAM_SIZE_11V11,
  FIELD_PLAYERS_PER_TEAM,
  DEFAULT_DURATION_SECONDS,
  GOAL_DEPTH,
  GOAL_TOP,
  GOAL_BOTTOM,
} from './constants.ts';

export { detectGoal } from './goals.ts';

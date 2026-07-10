export type Side = 'home' | 'away';
export type FieldRole = 'gk' | 'def' | 'mid' | 'fwd';
export type PlayerKind = 'human' | 'bot';
export type BallState = 'free' | 'controlled' | 'kicked' | 'contested';
export type MatchPhase = 'playing' | 'goal' | 'setPiece' | 'finished';
export type FormationId = '4-3-3' | '4-4-2' | '3-5-2' | '4-2-3-1';

/** Network input DTO for a human-controlled slot. */
export type PlayerInput = {
  dirx: number;
  diry: number;
  sprint: boolean;
  shoot: boolean;
  pass: boolean;
  clear: boolean;
  tackle: boolean;
  seq: number;
};

export type MatchConfig = {
  durationSeconds?: number;
  homeFormationId?: FormationId;
  awayFormationId?: FormationId;
  /** Player id mapped to the home human outfield slot. */
  homeHumanPlayerId?: string;
  /** Player id mapped to the away human outfield slot. */
  awayHumanPlayerId?: string;
  seed?: number;
  /** Optional initial ball state (useful for tests / replays). */
  initialBall?: { x: number; y: number; vx?: number; vy?: number };
};

export type Vec2 = { x: number; y: number };

export type PlayerSnapshot = {
  id: string;
  side: Side;
  slot: number;
  role: FieldRole;
  kind: PlayerKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type BallSnapshot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: BallState;
  controllerId: string | null;
  lastTouchSide: Side | null;
};

export type MatchSnapshot = {
  tick: number;
  timeMs: number;
  clockSeconds: number;
  durationSeconds: number;
  phase: MatchPhase;
  score: { home: number; away: number };
  ball: BallSnapshot;
  players: PlayerSnapshot[];
  humanSlots: { home: string | null; away: string | null };
};

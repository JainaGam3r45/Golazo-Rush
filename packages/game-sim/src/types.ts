export type Side = 'home' | 'away';
export type FieldRole = 'gk' | 'def' | 'mid' | 'fwd';
export type PlayerKind = 'human' | 'bot';
export type BallState = 'free' | 'controlled' | 'kicked' | 'contested';
export type MatchPhase = 'playing' | 'goal' | 'setPiece' | 'halftime' | 'finished';
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

/** Maps a human controller to an outfield pitch index (0–9; GK stays bot). */
export type HumanAssignment = {
  playerId: string;
  side: Side;
  fieldSlot: number;
};

export type MatchConfig = {
  durationSeconds?: number;
  homeFormationId?: FormationId;
  awayFormationId?: FormationId;
  /** Custom 10-outfield lineup (normalized). Overrides formation anchors when length is 10. */
  homeLineup?: Array<{ nx: number; ny: number; role?: Exclude<FieldRole, 'gk'> }>;
  awayLineup?: Array<{ nx: number; ny: number; role?: Exclude<FieldRole, 'gk'> }>;
  /** Multi-human pitch assignments (preferred). */
  humanAssignments?: HumanAssignment[];
  /** @deprecated Prefer humanAssignments. Maps to home fieldSlot 0. */
  homeHumanPlayerId?: string;
  /** @deprecated Prefer humanAssignments. Maps to away fieldSlot 0. */
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
  half: 1 | 2;
  phase: MatchPhase;
  score: { home: number; away: number };
  ball: BallSnapshot;
  players: PlayerSnapshot[];
  /** First human id per side (legacy convenience). */
  humanSlots: { home: string | null; away: string | null };
  humanAssignments: HumanAssignment[];
};

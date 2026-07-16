import type {
  FormationId,
  HumanAssignment,
  MatchConfig,
  MatchPhase,
  MatchSnapshot,
  PlayerInput,
  Side,
} from './types.ts';
import {
  DEFAULT_DURATION_SECONDS,
  FIELD_PLAYERS_PER_TEAM,
  FIXED_DT_CAP_MS,
  GOAL_RESET_PAUSE_MS,
  HALFTIME_PAUSE_MS,
  MATCH_TIME_SCALE,
  GOALKEEPER_AWAY_X,
  GOALKEEPER_HOME_X,
  GOAL_CENTER_Y,
  PITCH_WIDTH,
  PLAYER_SPEED,
  SPRINT_COOLDOWN_MS,
  SPRINT_DURATION_MS,
  SPRINT_MULTIPLIER,
  getFieldAnchors,
  getKickoffBallPosition,
  len,
  normalize,
  type SpawnAnchor,
} from './constants.ts';
import { createBall, integrateBall, resetBall, setBallVelocity, toBallSnapshot, type SimBall } from './ball.ts';
import {
  createPlayer,
  integratePlayer,
  resetPlayer,
  setVelocity,
  stopPlayer,
  toPlayerSnapshot,
  type SimPlayer,
} from './player.ts';
import {
  createPossessionState,
  resetPossession,
  updatePossession,
  type PossessionState,
} from './possession.ts';
import { executeClear, executePass, findPassTarget, kickBall, tryTackle } from './actions.ts';
import { updateBots, updateGoalkeeper } from './bots.ts';
import { detectGoal } from './goals.ts';

export type Match = {
  applyInput(playerId: string, input: PlayerInput): void;
  tick(dtMs: number, inputsByPlayerId?: Record<string, PlayerInput>): MatchSnapshot;
  getSnapshot(): MatchSnapshot;
  getPhase(): MatchPhase;
  isFinished(): boolean;
};

type InternalMatch = {
  durationSeconds: number;
  homeFormationId: FormationId;
  awayFormationId: FormationId;
  humanAssignments: HumanAssignment[];
  homeAnchors: SpawnAnchor[];
  awayAnchors: SpawnAnchor[];
  players: SimPlayer[];
  ball: SimBall;
  possession: PossessionState;
  phase: MatchPhase;
  timeMs: number;
  tickCount: number;
  clockSeconds: number;
  half: 1 | 2;
  score: { home: number; away: number };
  kickoffSide: Side;
  phaseUntil: number;
  pendingInputs: Map<string, PlayerInput>;
  lastSeq: Map<string, number>;
};

function resolveFormation(id: FormationId | undefined): FormationId {
  return id ?? '4-4-2';
}

function resolveHumanAssignments(config: MatchConfig): HumanAssignment[] {
  if (config.humanAssignments?.length) {
    return config.humanAssignments.map((a) => ({
      playerId: a.playerId,
      side: a.side === 'away' ? 'away' : 'home',
      fieldSlot: Math.max(0, Math.min(9, Math.floor(a.fieldSlot))),
    }));
  }
  const out: HumanAssignment[] = [];
  if (config.homeHumanPlayerId) {
    out.push({ playerId: config.homeHumanPlayerId, side: 'home', fieldSlot: 0 });
  }
  if (config.awayHumanPlayerId) {
    out.push({ playerId: config.awayHumanPlayerId, side: 'away', fieldSlot: 0 });
  }
  return out;
}

function humanAt(state: InternalMatch, side: Side, fieldSlot: number): HumanAssignment | null {
  return (
    state.humanAssignments.find((a) => a.side === side && a.fieldSlot === fieldSlot) ?? null
  );
}

function firstHumanId(state: InternalMatch, side: Side): string | null {
  return state.humanAssignments.find((a) => a.side === side)?.playerId ?? null;
}

function buildRoster(state: InternalMatch): void {
  state.players = [];

  state.players.push(
    createPlayer({
      id: 'home-gk',
      side: 'home',
      slot: -1,
      role: 'gk',
      kind: 'bot',
      x: GOALKEEPER_HOME_X,
      y: GOAL_CENTER_Y,
    }),
  );
  state.players.push(
    createPlayer({
      id: 'away-gk',
      side: 'away',
      slot: -1,
      role: 'gk',
      kind: 'bot',
      x: GOALKEEPER_AWAY_X,
      y: GOAL_CENTER_Y,
    }),
  );

  for (const anchor of state.homeAnchors) {
    const human = humanAt(state, 'home', anchor.slot);
    state.players.push(
      createPlayer({
        id: human ? human.playerId : `home-bot-${anchor.slot}`,
        side: 'home',
        slot: anchor.slot,
        role: anchor.role,
        kind: human ? 'human' : 'bot',
        x: anchor.x,
        y: anchor.y,
      }),
    );
  }

  for (const anchor of state.awayAnchors) {
    const human = humanAt(state, 'away', anchor.slot);
    state.players.push(
      createPlayer({
        id: human ? human.playerId : `away-bot-${anchor.slot}`,
        side: 'away',
        slot: anchor.slot,
        role: anchor.role,
        kind: human ? 'human' : 'bot',
        x: anchor.x,
        y: anchor.y,
      }),
    );
  }
}

function applyHumanInput(state: InternalMatch, player: SimPlayer, input: PlayerInput): void {
  const last = state.lastSeq.get(player.id) ?? -1;
  if (input.seq < last) return;
  state.lastSeq.set(player.id, input.seq);

  let speed = PLAYER_SPEED;
  if (input.sprint && state.timeMs >= player.sprintCooldownUntil) {
    if (player.sprintUntil <= state.timeMs) {
      player.sprintUntil = state.timeMs + SPRINT_DURATION_MS;
      player.sprintCooldownUntil = state.timeMs + SPRINT_DURATION_MS + SPRINT_COOLDOWN_MS;
    }
  }
  if (state.timeMs < player.sprintUntil) {
    speed = PLAYER_SPEED * SPRINT_MULTIPLIER;
  }

  const dirLen = len(input.dirx, input.diry);
  if (dirLen > 0.01) {
    const n = normalize(input.dirx, input.diry);
    setVelocity(player, n.x * speed, n.y * speed, speed);
  } else {
    stopPlayer(player);
  }

  if (state.phase !== 'playing') return;

  if (input.shoot) {
    kickBall(player, state.ball, state.possession, state.timeMs, false);
  }
  if (input.pass) {
    const teammates = state.players.filter((p) => p.side === player.side);
    const opponents = state.players.filter((p) => p.side !== player.side);
    const target = findPassTarget(player, teammates, opponents);
    if (target) {
      executePass(player, state.ball, target, state.possession, state.timeMs);
    } else {
      const goalX = player.side === 'home' ? PITCH_WIDTH : 0;
      executePass(player, state.ball, { x: goalX, y: GOAL_CENTER_Y }, state.possession, state.timeMs);
    }
  }
  if (input.clear) {
    executeClear(player, state.ball, state.possession, state.timeMs);
  }
  if (input.tackle) {
    tryTackle(player, state.ball, state.possession, state.players, state.timeMs);
  }
}

function checkGoal(state: InternalMatch): void {
  if (state.phase !== 'playing') return;
  const scorer = detectGoal(state.ball.x, state.ball.y);
  if (!scorer) return;

  if (scorer === 'home') {
    state.score.home += 1;
    state.kickoffSide = 'away';
  } else {
    state.score.away += 1;
    state.kickoffSide = 'home';
  }
  enterGoalPhase(state);
}

function enterGoalPhase(state: InternalMatch): void {
  state.phase = 'goal';
  state.phaseUntil = state.timeMs + GOAL_RESET_PAUSE_MS;
  resetPossession(state.possession);
  resetPositions(state);
}

function resetPositions(state: InternalMatch): void {
  for (const player of state.players) {
    if (player.role === 'gk') {
      resetPlayer(
        player,
        player.side === 'home' ? GOALKEEPER_HOME_X : GOALKEEPER_AWAY_X,
        GOAL_CENTER_Y,
      );
      continue;
    }
    const anchors = player.side === 'home' ? state.homeAnchors : state.awayAnchors;
    const anchor = anchors.find((a) => a.slot === player.slot) ?? anchors[0];
    if (anchor) resetPlayer(player, anchor.x, anchor.y);
  }
  const kickoff = getKickoffBallPosition(state.kickoffSide);
  resetBall(state.ball, kickoff.x, kickoff.y);
}

function updatePhase(state: InternalMatch): void {
  if (state.phase === 'finished') return;

  if (state.phase === 'playing') {
    if (state.half === 1 && state.clockSeconds >= state.durationSeconds / 2) {
      state.clockSeconds = state.durationSeconds / 2;
      state.phase = 'halftime';
      state.phaseUntil = state.timeMs + HALFTIME_PAUSE_MS;
      state.kickoffSide = 'away';
      resetPossession(state.possession);
      resetPositions(state);
      for (const player of state.players) stopPlayer(player);
      return;
    }

    if (state.half === 2 && state.clockSeconds >= state.durationSeconds) {
      state.clockSeconds = state.durationSeconds;
      state.phase = 'finished';
      for (const player of state.players) stopPlayer(player);
      resetBall(state.ball, state.ball.x, state.ball.y);
      return;
    }
  }

  if (state.phase === 'halftime' && state.timeMs >= state.phaseUntil) {
    state.half = 2;
    state.phase = 'playing';
    state.kickoffSide = 'away';
    resetPossession(state.possession);
    resetPositions(state);
  } else if (state.phase === 'goal' && state.timeMs >= state.phaseUntil) {
    state.phase = 'playing';
  }
}

function runAi(state: InternalMatch): void {
  if (state.phase !== 'playing') return;

  const homeBots = state.players.filter((p) => p.side === 'home' && p.kind === 'bot' && p.role !== 'gk');
  const awayBots = state.players.filter((p) => p.side === 'away' && p.kind === 'bot' && p.role !== 'gk');
  const homeGk = state.players.find((p) => p.id === 'home-gk')!;
  const awayGk = state.players.find((p) => p.id === 'away-gk')!;

  updateBots(
    homeBots,
    state.ball,
    state.possession,
    state.players,
    state.homeAnchors,
    state.homeFormationId,
    'home',
    state.timeMs,
  );
  updateBots(
    awayBots,
    state.ball,
    state.possession,
    state.players,
    state.awayAnchors,
    state.awayFormationId,
    'away',
    state.timeMs,
  );

  updateGoalkeeper(
    homeGk,
    state.ball,
    state.possession,
    state.timeMs,
    state.players.filter((p) => p.side === 'away'),
  );
  updateGoalkeeper(
    awayGk,
    state.ball,
    state.possession,
    state.timeMs,
    state.players.filter((p) => p.side === 'home'),
  );
}

function snapshotOf(state: InternalMatch): MatchSnapshot {
  return {
    tick: state.tickCount,
    timeMs: Math.round(state.timeMs),
    clockSeconds: Math.floor(state.clockSeconds),
    durationSeconds: state.durationSeconds,
    half: state.half,
    phase: state.phase,
    score: { home: state.score.home, away: state.score.away },
    ball: toBallSnapshot(
      state.ball,
      state.possession.ballState,
      state.possession.controllerId,
      state.possession.lastTouchSide,
    ),
    players: state.players.map(toPlayerSnapshot),
    humanSlots: {
      home: firstHumanId(state, 'home'),
      away: firstHumanId(state, 'away'),
    },
    humanAssignments: state.humanAssignments.map((a) => ({ ...a })),
  };
}

function step(state: InternalMatch, dtMs: number): void {
  const clamped = Math.min(Math.max(dtMs, 0), FIXED_DT_CAP_MS);
  if (clamped <= 0) return;

  state.timeMs += clamped;
  state.tickCount += 1;

  if (state.phase === 'playing') {
    state.clockSeconds += (clamped / 1000) * MATCH_TIME_SCALE;
  }

  updatePhase(state);
  if (state.phase === 'finished') return;

  // Merge pending inputs for this tick.
  for (const [playerId, input] of state.pendingInputs) {
    const player = state.players.find((p) => p.id === playerId);
    if (player && player.kind === 'human') {
      applyHumanInput(state, player, input);
    }
  }
  state.pendingInputs.clear();

  if (state.phase === 'playing') {
    runAi(state);
  } else {
    for (const player of state.players) stopPlayer(player);
  }

  const dtSec = clamped / 1000;
  for (const player of state.players) {
    integratePlayer(player, dtSec);
  }

  if (state.possession.ballState !== 'controlled') {
    integrateBall(state.ball, dtSec);
  }

  updatePossession(state.possession, state.ball, state.players, state.timeMs);
  checkGoal(state);
  updatePhase(state);
}

export function createMatch(config: MatchConfig = {}): Match {
  const homeFormationId = resolveFormation(config.homeFormationId);
  const awayFormationId = resolveFormation(config.awayFormationId);
  const homeAnchors = getFieldAnchors(homeFormationId, 'home', config.homeLineup);
  const awayAnchors = getFieldAnchors(awayFormationId, 'away', config.awayLineup);

  if (homeAnchors.length !== FIELD_PLAYERS_PER_TEAM || awayAnchors.length !== FIELD_PLAYERS_PER_TEAM) {
    throw new Error('game-sim only supports 11v11 (10 outfield + GK per side)');
  }

  const kickoff = getKickoffBallPosition('home');
  const ball = createBall(
    config.initialBall?.x ?? kickoff.x,
    config.initialBall?.y ?? kickoff.y,
  );
  if (config.initialBall?.vx != null || config.initialBall?.vy != null) {
    setBallVelocity(ball, config.initialBall.vx ?? 0, config.initialBall.vy ?? 0);
  }

  const humanAssignments = resolveHumanAssignments(config);
  const seenSlots = new Set<string>();
  for (const a of humanAssignments) {
    const key = `${a.side}:${a.fieldSlot}`;
    if (seenSlots.has(key)) {
      throw new Error(`duplicate human assignment for ${key}`);
    }
    seenSlots.add(key);
  }

  const state: InternalMatch = {
    durationSeconds: config.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    homeFormationId,
    awayFormationId,
    humanAssignments,
    homeAnchors,
    awayAnchors,
    players: [],
    ball,
    possession: createPossessionState(),
    phase: 'playing',
    timeMs: 0,
    tickCount: 0,
    clockSeconds: 0,
    half: 1,
    score: { home: 0, away: 0 },
    kickoffSide: 'home',
    phaseUntil: 0,
    pendingInputs: new Map(),
    lastSeq: new Map(),
  };

  buildRoster(state);

  for (const a of state.humanAssignments) {
    const player = state.players.find((p) => p.id === a.playerId);
    if (!player || player.kind !== 'human') {
      throw new Error(`human slot failed to initialize (${a.side}/${a.fieldSlot})`);
    }
  }

  return {
    applyInput(playerId: string, input: PlayerInput): void {
      state.pendingInputs.set(playerId, input);
    },

    tick(dtMs: number, inputsByPlayerId?: Record<string, PlayerInput>): MatchSnapshot {
      if (inputsByPlayerId) {
        for (const [playerId, input] of Object.entries(inputsByPlayerId)) {
          state.pendingInputs.set(playerId, input);
        }
      }
      step(state, dtMs);
      return snapshotOf(state);
    },

    getSnapshot(): MatchSnapshot {
      return snapshotOf(state);
    },

    getPhase(): MatchPhase {
      return state.phase;
    },

    isFinished(): boolean {
      return state.phase === 'finished';
    },
  };
}

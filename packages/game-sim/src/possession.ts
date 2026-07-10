import type { BallState, Side } from './types.ts';
import type { SimBall } from './ball.ts';
import { isBallIdle, setBallVelocity } from './ball.ts';
import type { SimPlayer } from './player.ts';
import { playerFacing } from './player.ts';
import {
  CONTESTED_MAX_MS,
  CONTROL_COOLDOWN_MS,
  CONTROL_LERP,
  CONTROL_VELOCITY_BLEND,
  KICK_OFFSET,
  KICK_RANGE,
  KICKED_DURATION_MS,
  PLAYER_RADIUS,
  dist,
} from './constants.ts';

export type PossessionState = {
  ballState: BallState;
  controllerId: string | null;
  lastTouchSide: Side | null;
  kickedUntil: number;
  contestedUntil: number;
  controlCooldownUntil: number;
};

export function createPossessionState(): PossessionState {
  return {
    ballState: 'free',
    controllerId: null,
    lastTouchSide: null,
    kickedUntil: 0,
    contestedUntil: 0,
    controlCooldownUntil: 0,
  };
}

export function resetPossession(state: PossessionState): void {
  state.ballState = 'free';
  state.controllerId = null;
  state.lastTouchSide = null;
  state.kickedUntil = 0;
  state.contestedUntil = 0;
  state.controlCooldownUntil = 0;
}

export function markBallKicked(state: PossessionState, time: number): void {
  state.ballState = 'kicked';
  state.controllerId = null;
  state.kickedUntil = time + KICKED_DURATION_MS;
}

export function transferControl(state: PossessionState, player: SimPlayer, time: number): void {
  state.ballState = 'controlled';
  state.controllerId = player.id;
  state.lastTouchSide = player.side;
  state.kickedUntil = 0;
  state.contestedUntil = 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function applyDribble(ball: SimBall, player: SimPlayer): void {
  const facing = playerFacing(player);
  const offset = PLAYER_RADIUS + KICK_OFFSET + 2;
  const targetX = player.x + facing.x * offset;
  const targetY = player.y + facing.y * offset;

  ball.x = lerp(ball.x, targetX, CONTROL_LERP);
  ball.y = lerp(ball.y, targetY, CONTROL_LERP);
  ball.vx = lerp(ball.vx, player.vx * CONTROL_VELOCITY_BLEND, CONTROL_LERP);
  ball.vy = lerp(ball.vy, player.vy * CONTROL_VELOCITY_BLEND, CONTROL_LERP);
}

function nearestBySide(players: SimPlayer[], ball: SimBall, side: Side): SimPlayer | null {
  let best: SimPlayer | null = null;
  let bestDist = Infinity;
  for (const player of players) {
    if (player.side !== side) continue;
    const d = dist(player.x, player.y, ball.x, ball.y);
    if (d < bestDist) {
      bestDist = d;
      best = player;
    }
  }
  return best;
}

export function updatePossession(
  state: PossessionState,
  ball: SimBall,
  players: SimPlayer[],
  time: number,
): void {
  if (state.ballState === 'kicked' && time >= state.kickedUntil) {
    state.ballState = 'free';
  }

  if (state.ballState === 'contested' && time >= state.contestedUntil) {
    setBallVelocity(ball, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160);
    state.ballState = 'free';
    state.controllerId = null;
    state.controlCooldownUntil = time + CONTROL_COOLDOWN_MS;
  }

  if (state.ballState === 'controlled' && state.controllerId) {
    const controller = players.find((p) => p.id === state.controllerId);
    if (!controller) {
      state.ballState = 'free';
      state.controllerId = null;
      return;
    }
    applyDribble(ball, controller);
    return;
  }

  if (state.ballState !== 'free' || time < state.controlCooldownUntil) return;
  if (!isBallIdle(ball)) return;

  const homeNearest = nearestBySide(players, ball, 'home');
  const awayNearest = nearestBySide(players, ball, 'away');
  const homeInRange = homeNearest && dist(homeNearest.x, homeNearest.y, ball.x, ball.y) <= KICK_RANGE;
  const awayInRange = awayNearest && dist(awayNearest.x, awayNearest.y, ball.x, ball.y) <= KICK_RANGE;

  if (homeInRange && awayInRange && homeNearest && awayNearest) {
    const homeDist = dist(homeNearest.x, homeNearest.y, ball.x, ball.y);
    const awayDist = dist(awayNearest.x, awayNearest.y, ball.x, ball.y);
    if (Math.abs(homeDist - awayDist) < 6) {
      state.ballState = 'contested';
      state.controllerId = null;
      state.contestedUntil = time + CONTESTED_MAX_MS;
      return;
    }
    transferControl(state, homeDist < awayDist ? homeNearest : awayNearest, time);
    return;
  }

  if (homeInRange && homeNearest) {
    transferControl(state, homeNearest, time);
    return;
  }
  if (awayInRange && awayNearest) {
    transferControl(state, awayNearest, time);
  }
}

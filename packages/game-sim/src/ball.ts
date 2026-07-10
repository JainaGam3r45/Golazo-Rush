import type { BallSnapshot, BallState, Side } from './types.ts';
import {
  BALL_BOUNCE,
  BALL_DRAG,
  BALL_IDLE_SPEED,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  GOAL_BOTTOM,
  GOAL_DEPTH,
  GOAL_TOP,
  PITCH_WIDTH,
  PLAYABLE_BOTTOM,
  PLAYABLE_LEFT,
  PLAYABLE_RIGHT,
  PLAYABLE_TOP,
  len,
} from './constants.ts';

function inGoalMouth(x: number, y: number): boolean {
  if (y < GOAL_TOP || y > GOAL_BOTTOM) return false;
  return x <= GOAL_DEPTH || x >= PITCH_WIDTH - GOAL_DEPTH;
}

export type SimBall = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export function createBall(x: number, y: number): SimBall {
  return { x, y, vx: 0, vy: 0 };
}

export function resetBall(ball: SimBall, x: number, y: number): void {
  ball.x = x;
  ball.y = y;
  ball.vx = 0;
  ball.vy = 0;
}

export function setBallVelocity(ball: SimBall, vx: number, vy: number): void {
  const speed = len(vx, vy);
  if (speed > BALL_MAX_SPEED) {
    const scale = BALL_MAX_SPEED / speed;
    vx *= scale;
    vy *= scale;
  }
  ball.vx = vx;
  ball.vy = vy;
}

export function isBallIdle(ball: SimBall): boolean {
  return len(ball.vx, ball.vy) < BALL_IDLE_SPEED;
}

export function integrateBall(ball: SimBall, dtSec: number): void {
  const dragFactor = Math.max(0, 1 - BALL_DRAG * dtSec);
  ball.vx *= dragFactor;
  ball.vy *= dragFactor;

  ball.x += ball.vx * dtSec;
  ball.y += ball.vy * dtSec;

  if (inGoalMouth(ball.x, ball.y)) {
    // Allow the ball into the goal mouth so scoring can detect it.
    if (ball.y < GOAL_TOP) {
      ball.y = GOAL_TOP;
      ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
    } else if (ball.y > GOAL_BOTTOM) {
      ball.y = GOAL_BOTTOM;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    }
    if (ball.x < 0) ball.x = 0;
    if (ball.x > PITCH_WIDTH) ball.x = PITCH_WIDTH;
    return;
  }

  if (ball.y < PLAYABLE_TOP) {
    ball.y = PLAYABLE_TOP;
    ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
  } else if (ball.y > PLAYABLE_BOTTOM) {
    ball.y = PLAYABLE_BOTTOM;
    ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
  }

  if (ball.x < PLAYABLE_LEFT) {
    ball.x = PLAYABLE_LEFT;
    ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
  } else if (ball.x > PLAYABLE_RIGHT) {
    ball.x = PLAYABLE_RIGHT;
    ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
  }
}

export function toBallSnapshot(
  ball: SimBall,
  state: BallState,
  controllerId: string | null,
  lastTouchSide: Side | null,
): BallSnapshot {
  return {
    x: round1(ball.x),
    y: round1(ball.y),
    vx: round1(ball.vx),
    vy: round1(ball.vy),
    state,
    controllerId,
    lastTouchSide,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export { BALL_RADIUS };

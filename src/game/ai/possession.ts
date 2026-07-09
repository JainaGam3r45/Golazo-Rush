import Phaser from 'phaser';
import type { Ball } from '../entities/Ball';
import type { FieldPlayer } from '../entities/FieldPlayer';
import { KICK_RANGE, KICK_OFFSET } from '../entities/FieldPlayer';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

export type TouchSide = 'home' | 'away' | null;
export type BallState = 'free' | 'controlled' | 'kicked' | 'contested';

const BALL_IDLE_SPEED = 45;
const CONTEST_RADIUS = 40;
const CONTROL_LERP = 0.25;
const CONTROL_VELOCITY_BLEND = 0.15;
const KICKED_DURATION_MS = 350;
const CONTESTED_MAX_MS = 600;
const CONTROL_COOLDOWN_MS = 500;

const JAM_SAMPLE_INTERVAL_MS = 200;
const JAM_WINDOW_MS = 2500;
const JAM_DISTANCE_PX = 18;
const JAM_PLAYER_RADIUS = 50;
const JAM_PUSH_FORCE = 180;

let lastTouchSide: TouchSide = null;
let lastTouchAt = 0;

let ballState: BallState = 'free';
let controller: FieldPlayer | null = null;
let kickedUntil = 0;
let contestedUntil = 0;
let controlCooldownUntil = 0;
let airTimeUntil = 0;

type PositionSample = { x: number; y: number; time: number };
const jamSamples: PositionSample[] = [];
let lastSignificantDir = { x: 1, y: 0 };

export function registerTouch(side: 'home' | 'away', time: number): void {
  lastTouchSide = side;
  lastTouchAt = time;
}

export function getLastTouchSide(): TouchSide {
  return lastTouchSide;
}

export function getLastTouchAt(): number {
  return lastTouchAt;
}

export function getBallState(): BallState {
  return ballState;
}

export function getBallController(): FieldPlayer | null {
  return controller;
}

export function isBallControlledBy(player: FieldPlayer): boolean {
  return ballState === 'controlled' && controller === player;
}

export function resetPossession(): void {
  lastTouchSide = null;
  lastTouchAt = 0;
  resetBallControl();
}

export function resetBallControl(): void {
  ballState = 'free';
  controller = null;
  kickedUntil = 0;
  contestedUntil = 0;
  controlCooldownUntil = 0;
  airTimeUntil = 0;
  jamSamples.length = 0;
}

export function isBallIdle(ball: {
  body: { velocity: { x: number; y: number } };
}): boolean {
  const speed = Math.sqrt(ball.body.velocity.x ** 2 + ball.body.velocity.y ** 2);
  return speed < BALL_IDLE_SPEED;
}

export function markBallKicked(time: number, longKick = false): void {
  ballState = 'kicked';
  controller = null;
  kickedUntil = time + KICKED_DURATION_MS;
  if (longKick) {
    airTimeUntil = time + 700;
  }
}

export function transferBallControl(player: FieldPlayer, time: number): void {
  ballState = 'controlled';
  controller = player;
  registerTouch(player.side, time);
  kickedUntil = 0;
  contestedUntil = 0;
}

export function getBallAirTime(): number {
  return airTimeUntil;
}

function getPlayerFacing(player: FieldPlayer): { x: number; y: number } {
  const vx = player.body.velocity.x;
  const vy = player.body.velocity.y;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > 8) {
    return { x: vx / speed, y: vy / speed };
  }
  const goalX = player.side === 'home' ? PITCH_WIDTH : 0;
  const dx = goalX - player.x;
  const dy = PITCH_HEIGHT / 2 - player.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

function findNearestCandidates(
  ball: Ball,
  players: FieldPlayer[],
): { nearest: FieldPlayer | null; homeNearest: FieldPlayer | null; awayNearest: FieldPlayer | null } {
  let nearest: FieldPlayer | null = null;
  let nearestDist = Infinity;
  let homeNearest: FieldPlayer | null = null;
  let homeDist = Infinity;
  let awayNearest: FieldPlayer | null = null;
  let awayDist = Infinity;

  for (const player of players) {
    const dist = player.distanceTo(ball.x, ball.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = player;
    }
    if (player.side === 'home' && dist < homeDist) {
      homeDist = dist;
      homeNearest = player;
    }
    if (player.side === 'away' && dist < awayDist) {
      awayDist = dist;
      awayNearest = player;
    }
  }

  return { nearest, homeNearest, awayNearest };
}

function countPlayersNearBall(ball: Ball, players: FieldPlayer[], radius: number): number {
  let count = 0;
  for (const player of players) {
    if (player.distanceTo(ball.x, ball.y) < radius) count++;
  }
  return count;
}

function applyDribbleControl(ball: Ball, player: FieldPlayer): void {
  const facing = getPlayerFacing(player);
  const offset = player.width / 2 + KICK_OFFSET + 2;
  const targetX = player.x + facing.x * offset;
  const targetY = player.y + facing.y * offset;

  ball.setPosition(
    Phaser.Math.Linear(ball.x, targetX, CONTROL_LERP),
    Phaser.Math.Linear(ball.y, targetY, CONTROL_LERP),
  );

  ball.body.setVelocity(
    Phaser.Math.Linear(ball.body.velocity.x, player.body.velocity.x * CONTROL_VELOCITY_BLEND, CONTROL_LERP),
    Phaser.Math.Linear(ball.body.velocity.y, player.body.velocity.y * CONTROL_VELOCITY_BLEND, CONTROL_LERP),
  );
}

function resolveControlState(
  ball: Ball,
  players: FieldPlayer[],
  time: number,
): void {
  if (ballState === 'kicked' && time >= kickedUntil) {
    ballState = 'free';
  }

  if (ballState === 'contested' && time >= contestedUntil) {
    ballState = 'free';
    controller = null;
  }

  if (ballState === 'controlled' && controller) {
    if (!players.includes(controller)) {
      ballState = 'free';
      controller = null;
      return;
    }
    applyDribbleControl(ball, controller);
    return;
  }

  if (ballState !== 'free' || time < controlCooldownUntil) return;
  if (!isBallIdle(ball)) return;

  const { homeNearest, awayNearest } = findNearestCandidates(ball, players);
  const homeInRange = homeNearest && homeNearest.distanceTo(ball.x, ball.y) <= KICK_RANGE;
  const awayInRange = awayNearest && awayNearest.distanceTo(ball.x, ball.y) <= KICK_RANGE;

  if (homeInRange && awayInRange) {
    const homeDist = homeNearest!.distanceTo(ball.x, ball.y);
    const awayDist = awayNearest!.distanceTo(ball.x, ball.y);
    if (Math.abs(homeDist - awayDist) < 6) {
      ballState = 'contested';
      controller = null;
      contestedUntil = time + CONTESTED_MAX_MS;
      return;
    }
    const winner = homeDist < awayDist ? homeNearest! : awayNearest!;
    transferBallControl(winner, time);
    return;
  }

  if (homeInRange) {
    transferBallControl(homeNearest!, time);
    return;
  }

  if (awayInRange) {
    transferBallControl(awayNearest!, time);
  }
}

function sampleBallJam(ball: Ball, time: number): void {
  const last = jamSamples[jamSamples.length - 1];
  if (last && time - last.time < JAM_SAMPLE_INTERVAL_MS) return;

  jamSamples.push({ x: ball.x, y: ball.y, time });
  const cutoff = time - JAM_WINDOW_MS;
  while (jamSamples.length > 0 && jamSamples[0].time < cutoff) {
    jamSamples.shift();
  }
}

function resolveBallJam(ball: Ball, players: FieldPlayer[], time: number): void {
  sampleBallJam(ball, time);
  if (jamSamples.length < 2) return;

  const oldest = jamSamples[0];
  if (time - oldest.time < JAM_WINDOW_MS - JAM_SAMPLE_INTERVAL_MS) return;

  const dx = ball.x - oldest.x;
  const dy = ball.y - oldest.y;
  if (Math.sqrt(dx * dx + dy * dy) >= JAM_DISTANCE_PX) return;

  const nearby = players.filter((p) => p.distanceTo(ball.x, ball.y) < JAM_PLAYER_RADIUS);
  if (nearby.length < 2) return;

  const speed = Math.sqrt(ball.body.velocity.x ** 2 + ball.body.velocity.y ** 2);
  if (speed > 20) {
    lastSignificantDir = {
      x: ball.body.velocity.x / speed,
      y: ball.body.velocity.y / speed,
    };
  }

  for (const player of nearby) {
    const px = player.x - ball.x;
    const py = player.y - ball.y;
    const dist = Math.sqrt(px * px + py * py) || 1;
    player.body.setVelocity((px / dist) * JAM_PUSH_FORCE, (py / dist) * JAM_PUSH_FORCE);
  }

  let pushX = lastSignificantDir.x;
  let pushY = lastSignificantDir.y;
  if (Math.abs(pushX) < 0.1 && Math.abs(pushY) < 0.1) {
    pushX = PITCH_WIDTH / 2 - ball.x;
    pushY = PITCH_HEIGHT / 2 - ball.y;
    const len = Math.sqrt(pushX * pushX + pushY * pushY) || 1;
    pushX /= len;
    pushY /= len;
  }

  ball.body.setVelocity(pushX * 280, pushY * 280);
  ballState = 'free';
  controller = null;
  controlCooldownUntil = time + CONTROL_COOLDOWN_MS;
  jamSamples.length = 0;
}

export function updateBallControl(ball: Ball, players: FieldPlayer[], time: number): void {
  if (ballState === 'kicked' || ballState === 'free' || ballState === 'contested') {
    resolveBallJam(ball, players, time);
  }
  resolveControlState(ball, players, time);
}

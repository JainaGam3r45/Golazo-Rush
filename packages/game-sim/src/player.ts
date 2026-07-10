import type { FieldRole, PlayerKind, PlayerSnapshot, Side, Vec2 } from './types.ts';
import {
  BOT_KICK_COOLDOWN_MS,
  BOT_SPEED,
  GK_KICK_COOLDOWN_MS,
  GK_SPEED,
  KICK_COOLDOWN_MS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  clampGkY,
  clampPlayer,
  len,
  normalize,
} from './constants.ts';

export type SimPlayer = {
  id: string;
  side: Side;
  slot: number;
  role: FieldRole;
  kind: PlayerKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  maxSpeed: number;
  kickCooldownMs: number;
  lastKickAt: number;
  lastPassAt: number;
  lastClearAt: number;
  lastTackleAt: number;
  sprintUntil: number;
  sprintCooldownUntil: number;
  lastDir: Vec2;
  homeX: number;
  homeY: number;
};

export function createPlayer(opts: {
  id: string;
  side: Side;
  slot: number;
  role: FieldRole;
  kind: PlayerKind;
  x: number;
  y: number;
}): SimPlayer {
  const isGk = opts.role === 'gk';
  const isHuman = opts.kind === 'human';
  return {
    id: opts.id,
    side: opts.side,
    slot: opts.slot,
    role: opts.role,
    kind: opts.kind,
    x: opts.x,
    y: opts.y,
    vx: 0,
    vy: 0,
    maxSpeed: isGk ? GK_SPEED : isHuman ? PLAYER_SPEED : BOT_SPEED,
    kickCooldownMs: isGk ? GK_KICK_COOLDOWN_MS : opts.kind === 'bot' ? BOT_KICK_COOLDOWN_MS : KICK_COOLDOWN_MS,
    lastKickAt: 0,
    lastPassAt: 0,
    lastClearAt: 0,
    lastTackleAt: 0,
    sprintUntil: 0,
    sprintCooldownUntil: 0,
    lastDir: { x: opts.side === 'home' ? 1 : -1, y: 0 },
    homeX: opts.x,
    homeY: opts.y,
  };
}

export function setVelocity(player: SimPlayer, vx: number, vy: number, speedCap?: number): void {
  const cap = speedCap ?? player.maxSpeed;
  const speed = len(vx, vy);
  if (speed > cap && speed > 0) {
    const scale = cap / speed;
    vx *= scale;
    vy *= scale;
  }
  player.vx = vx;
  player.vy = vy;
  if (speed > 8) {
    player.lastDir = normalize(vx, vy);
  }
}

export function stopPlayer(player: SimPlayer): void {
  player.vx = 0;
  player.vy = 0;
}

export function moveToward(player: SimPlayer, targetX: number, targetY: number, speed = player.maxSpeed): void {
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distance = len(dx, dy);
  if (distance < 4) {
    stopPlayer(player);
    return;
  }
  setVelocity(player, (dx / distance) * speed, (dy / distance) * speed, speed);
}

export function integratePlayer(player: SimPlayer, dtSec: number): void {
  player.x += player.vx * dtSec;
  player.y += player.vy * dtSec;

  if (player.role === 'gk') {
    player.x = player.homeX;
    player.y = clampGkY(player.y);
    return;
  }

  const clamped = clampPlayer(player.x, player.y);
  player.x = clamped.x;
  player.y = clamped.y;
}

export function resetPlayer(player: SimPlayer, x: number, y: number): void {
  player.x = x;
  player.y = y;
  player.homeX = x;
  player.homeY = y;
  stopPlayer(player);
  player.lastKickAt = 0;
  player.lastPassAt = 0;
  player.lastClearAt = 0;
  player.lastTackleAt = 0;
  player.sprintUntil = 0;
  player.sprintCooldownUntil = 0;
}

export function playerFacing(player: SimPlayer): Vec2 {
  const speed = len(player.vx, player.vy);
  if (speed > 8) return normalize(player.vx, player.vy);
  return { ...player.lastDir };
}

export function toPlayerSnapshot(player: SimPlayer): PlayerSnapshot {
  return {
    id: player.id,
    side: player.side,
    slot: player.slot,
    role: player.role,
    kind: player.kind,
    x: round1(player.x),
    y: round1(player.y),
    vx: round1(player.vx),
    vy: round1(player.vy),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export { PLAYER_RADIUS };

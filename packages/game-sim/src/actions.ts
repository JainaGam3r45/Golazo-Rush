import type { SimBall } from './ball.ts';
import { setBallVelocity } from './ball.ts';
import type { SimPlayer } from './player.ts';
import { playerFacing } from './player.ts';
import type { PossessionState } from './possession.ts';
import { markBallKicked, transferControl } from './possession.ts';
import {
  CHARGED_KICK_FORCE,
  CLEAR_COOLDOWN_MS,
  KICK_FORCE,
  KICK_OFFSET,
  KICK_RANGE,
  PASS_COOLDOWN_MS,
  PLAYER_RADIUS,
  PITCH_HEIGHT,
  TACKLE_COOLDOWN_MS,
  TACKLE_RANGE,
  dist,
  len,
  normalize,
  opponentGoalX,
} from './constants.ts';
import { isBallIdle } from './ball.ts';

export function canKick(player: SimPlayer, time: number): boolean {
  return time - player.lastKickAt >= player.kickCooldownMs;
}

export function kickBall(
  player: SimPlayer,
  ball: SimBall,
  possession: PossessionState,
  time: number,
  charged = false,
  forceScale = 1,
  direction?: { x: number; y: number },
): boolean {
  if (!canKick(player, time)) return false;
  if (dist(player.x, player.y, ball.x, ball.y) > KICK_RANGE + 4) return false;

  let dir = direction ?? playerFacing(player);
  if (!direction) {
    const toBall = normalize(ball.x - player.x, ball.y - player.y);
    if (len(player.vx, player.vy) < 8) dir = toBall;
  }
  const n = normalize(dir.x, dir.y);

  ball.x = player.x + n.x * (PLAYER_RADIUS + KICK_OFFSET);
  ball.y = player.y + n.y * (PLAYER_RADIUS + KICK_OFFSET);

  const force = (charged ? CHARGED_KICK_FORCE : KICK_FORCE) * forceScale * (charged ? 1.15 : 1);
  setBallVelocity(ball, n.x * force, n.y * force);
  player.lastKickAt = time;
  possession.lastTouchSide = player.side;
  markBallKicked(possession, time);
  return true;
}

export function findPassTarget(passer: SimPlayer, teammates: SimPlayer[], opponents: SimPlayer[]): SimPlayer | null {
  const goalX = opponentGoalX(passer.side);
  const goalY = PITCH_HEIGHT / 2;
  let best: SimPlayer | null = null;
  let bestScore = -Infinity;

  for (const mate of teammates) {
    if (mate.id === passer.id) continue;
    const d = dist(passer.x, passer.y, mate.x, mate.y);
    if (d < 40 || d > 220) continue;

    const toGoal = Math.atan2(goalY - mate.y, goalX - mate.x);
    const toMate = Math.atan2(mate.y - passer.y, mate.x - passer.x);
    let angle = toGoal - toMate;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    const forwardBonus = Math.max(0, 1 - Math.abs(angle) / Math.PI) * 40;
    const distScore = 80 - Math.abs(d - 100) * 0.3;
    const laneClear = isLaneClear(passer, mate, opponents);
    const score = distScore + forwardBonus + (laneClear ? 25 : -30);
    if (score > bestScore) {
      bestScore = score;
      best = mate;
    }
  }

  return bestScore > 0 ? best : null;
}

function isLaneClear(from: SimPlayer, to: SimPlayer, opponents: SimPlayer[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = len(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  for (const opp of opponents) {
    const ox = opp.x - from.x;
    const oy = opp.y - from.y;
    const proj = ox * nx + oy * ny;
    if (proj < 0 || proj > d) continue;
    if (Math.abs(ox * ny - oy * nx) < 22) return false;
  }
  return true;
}

export function executePass(
  passer: SimPlayer,
  ball: SimBall,
  target: { x: number; y: number },
  possession: PossessionState,
  time: number,
  longPass = false,
): boolean {
  if (!canKick(passer, time)) return false;
  if (dist(passer.x, passer.y, ball.x, ball.y) > KICK_RANGE + 4) return false;
  if (time - passer.lastPassAt < PASS_COOLDOWN_MS) return false;

  const n = normalize(target.x - passer.x, target.y - passer.y);
  const d = dist(passer.x, passer.y, target.x, target.y);
  const baseForce = longPass ? CHARGED_KICK_FORCE * 0.95 : KICK_FORCE * 0.72;
  const distScale = Math.min(1.15, Math.max(0.7, d / (longPass ? 300 : 140)));

  ball.x = passer.x + n.x * (PLAYER_RADIUS + 14);
  ball.y = passer.y + n.y * (PLAYER_RADIUS + 14);
  setBallVelocity(ball, n.x * baseForce * distScale, n.y * baseForce * distScale);

  passer.lastKickAt = time;
  passer.lastPassAt = time;
  possession.lastTouchSide = passer.side;
  markBallKicked(possession, time);
  return true;
}

export function executeClear(
  player: SimPlayer,
  ball: SimBall,
  possession: PossessionState,
  time: number,
): boolean {
  if (time - player.lastClearAt < CLEAR_COOLDOWN_MS) return false;
  const goalX = opponentGoalX(player.side);
  const dir = normalize(goalX - player.x, PITCH_HEIGHT / 2 - player.y);
  const ok = kickBall(player, ball, possession, time, true, 1.1, dir);
  if (ok) player.lastClearAt = time;
  return ok;
}

export function tryTackle(
  tackler: SimPlayer,
  ball: SimBall,
  possession: PossessionState,
  players: SimPlayer[],
  time: number,
): boolean {
  if (time - tackler.lastTackleAt < TACKLE_COOLDOWN_MS) return false;

  let victim: SimPlayer | null = null;
  if (possession.controllerId) {
    const controller = players.find((p) => p.id === possession.controllerId);
    if (controller && controller.side !== tackler.side) victim = controller;
  } else if (possession.ballState === 'free' || possession.ballState === 'contested') {
    for (const opp of players) {
      if (opp.side === tackler.side) continue;
      if (
        dist(tackler.x, tackler.y, opp.x, opp.y) <= TACKLE_RANGE &&
        dist(tackler.x, tackler.y, ball.x, ball.y) <= TACKLE_RANGE &&
        isBallIdle(ball)
      ) {
        victim = opp;
        break;
      }
    }
  }

  if (!victim || dist(tackler.x, tackler.y, victim.x, victim.y) > TACKLE_RANGE) return false;

  tackler.lastTackleAt = time;
  setBallVelocity(ball, 0, 0);
  transferControl(possession, tackler, time);
  return true;
}

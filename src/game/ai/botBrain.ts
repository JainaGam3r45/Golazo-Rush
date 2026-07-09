import type { Ball } from '../entities/Ball';
import type { BotPlayer } from '../entities/BotPlayer';
import type { FormationPreset } from '../../lib/match/formations';
import type { SpawnAnchor, FieldRole } from '../config/spawnLayouts';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { isBallIdle } from './possession';
import { applyAntiStuck } from './antiStuck';
import { applySeparation, getBallApproachOffset, getSpeedVariance } from './separation';

export const ENABLE_SIMPLE_PASS = false;

const BOT_SPEED = 187;
const PRESSURE_DISTANCE = 50;
const DEF_FORWARD_LIMIT = 0.55;

export type KickCallback = (side: 'home' | 'away', x: number, y: number) => void;

type BotRole = 'presser' | 'supporter' | 'holder';

function getGoalX(side: 'home' | 'away'): number {
  return side === 'home' ? PITCH_WIDTH : 0;
}

function getOpponentGoalX(side: 'home' | 'away'): number {
  return getGoalX(side === 'home' ? 'away' : 'home');
}

function findPresserIndex(bots: BotPlayer[], ball: Ball): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < bots.length; i++) {
    const dist = bots[i].distanceTo(ball.x, ball.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function findSupporterIndex(bots: BotPlayer[], ball: Ball, presserIdx: number, side: 'home' | 'away'): number {
  const goalX = getOpponentGoalX(side);
  const goalY = PITCH_HEIGHT / 2;
  let best = -1;
  let bestScore = Infinity;

  for (let i = 0; i < bots.length; i++) {
    if (i === presserIdx) continue;
    const bot = bots[i];
    const midX = (ball.x + goalX) / 2;
    const midY = (ball.y + goalY) / 2;
    const dist = bot.distanceTo(midX, midY);
    if (dist < bestScore) {
      bestScore = dist;
      best = i;
    }
  }
  return best;
}

function assignRoles(bots: BotPlayer[], ball: Ball, side: 'home' | 'away'): Map<number, BotRole> {
  const roles = new Map<number, BotRole>();
  const presserIdx = findPresserIndex(bots, ball);
  const supporterIdx = findSupporterIndex(bots, ball, presserIdx, side);

  for (let i = 0; i < bots.length; i++) {
    if (i === presserIdx) {
      roles.set(i, 'presser');
    } else if (i === supporterIdx) {
      roles.set(i, 'supporter');
    } else {
      roles.set(i, 'holder');
    }
  }
  return roles;
}

function getRoleForAnchor(anchor: SpawnAnchor): FieldRole {
  return anchor.role;
}

function clampHolderTarget(
  anchor: SpawnAnchor,
  targetX: number,
  targetY: number,
  side: 'home' | 'away',
): { x: number; y: number } {
  const role = getRoleForAnchor(anchor);
  const midX = PITCH_WIDTH / 2;

  if (role === 'def') {
    const maxX = side === 'home' ? midX * DEF_FORWARD_LIMIT : midX + midX * (1 - DEF_FORWARD_LIMIT);
    if (side === 'home') {
      return { x: Math.min(targetX, maxX), y: targetY };
    }
    return { x: Math.max(targetX, maxX), y: targetY };
  }

  if (role === 'fwd') {
    const minX = side === 'home' ? midX + 40 : midX - 40;
    if (side === 'home') {
      return { x: Math.max(targetX, minX), y: targetY };
    }
    return { x: Math.min(targetX, minX), y: targetY };
  }

  return { x: targetX, y: targetY };
}

function shiftAnchorTowardBall(
  anchor: SpawnAnchor,
  ball: Ball,
  side: 'home' | 'away',
  lineHeight: number,
): { x: number; y: number } {
  const inOwnHalf =
    side === 'home' ? ball.x < PITCH_WIDTH / 2 : ball.x > PITCH_WIDTH / 2;
  if (!inOwnHalf) {
    return { x: anchor.x, y: anchor.y };
  }

  const shift = lineHeight * 60;
  const dx = ball.x - anchor.x;
  const dy = ball.y - anchor.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: anchor.x + (dx / dist) * shift,
    y: anchor.y + (dy / dist) * shift,
  };
}

function countNearbyOpponents(
  bot: BotPlayer,
  opponents: BotPlayer[],
  radius: number,
): number {
  let count = 0;
  for (const opp of opponents) {
    if (bot.distanceTo(opp.x, opp.y) < radius) count++;
  }
  return count;
}

function handleBotWithBall(
  bot: BotPlayer,
  ball: Ball,
  side: 'home' | 'away',
  formation: FormationPreset,
  opponents: BotPlayer[],
  time: number,
  onKick?: KickCallback,
): void {
  const goalX = getOpponentGoalX(side);
  const goalY = PITCH_HEIGHT / 2;
  const distToGoal = Math.abs(bot.x - goalX);
  const aligned = Math.abs(bot.y - goalY) < 120;
  const pressured = countNearbyOpponents(bot, opponents, PRESSURE_DISTANCE) > 0;

  if (pressured) {
    if (bot.kickBall(ball, false, time, 1.1)) {
      onKick?.(side, bot.x, bot.y);
    }
    return;
  }

  if (distToGoal < formation.shootDistance && aligned) {
    if (bot.kickBall(ball, false, time)) {
      onKick?.(side, bot.x, bot.y);
    }
    return;
  }

  bot.moveToward(goalX, goalY, BOT_SPEED * formation.pressWeight * getSpeedVariance(bot.slot));
}

export function updateTeamBots(
  bots: BotPlayer[],
  ball: Ball,
  anchors: SpawnAnchor[],
  formation: FormationPreset,
  side: 'home' | 'away',
  time: number,
  opponents: BotPlayer[] = [],
  onKick?: KickCallback,
): void {
  if (bots.length === 0) return;

  const roles = assignRoles(bots, ball, side);
  const goalX = getOpponentGoalX(side);
  const goalY = PITCH_HEIGHT / 2;

  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const anchor = anchors[bot.slot] ?? anchors[i];
    if (!anchor) continue;

    const role = roles.get(i) ?? 'holder';
    const speedMult = getSpeedVariance(bot.slot);

    if (role === 'presser') {
      const distToBall = bot.distanceTo(ball.x, ball.y);
      const hasBall = distToBall <= bot.kickRange && isBallIdle(ball);

      if (hasBall) {
        handleBotWithBall(bot, ball, side, formation, opponents, time, onKick);
      } else {
        const offset = getBallApproachOffset(bot.slot);
        let targetX = ball.x + offset.x;
        let targetY = ball.y + offset.y;

        if (anchor.role === 'def') {
          const inOwnHalf =
            side === 'home' ? ball.x < PITCH_WIDTH / 2 : ball.x > PITCH_WIDTH / 2;
          if (!inOwnHalf) {
            const clamped = clampHolderTarget(anchor, anchor.x, anchor.y, side);
            targetX = clamped.x;
            targetY = clamped.y;
          }
        }

        const separated = applySeparation(bot, bots, targetX, targetY);
        const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
        const chaseSpeed = BOT_SPEED * (0.9 + formation.pressWeight * 0.15) * speedMult;
        bot.moveToward(unstuck.x, unstuck.y, chaseSpeed);
      }
      continue;
    }

    if (role === 'supporter') {
      const supportX = (ball.x + goalX) / 2;
      const supportY = (ball.y + goalY) / 2;
      const separated = applySeparation(bot, bots, supportX, supportY);
      const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
      bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.85 * speedMult);
      continue;
    }

    const shifted = shiftAnchorTowardBall(anchor, ball, side, formation.lineHeight);
    const clamped = clampHolderTarget(anchor, shifted.x, shifted.y, side);
    const separated = applySeparation(bot, bots, clamped.x, clamped.y);
    const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
    bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.8 * speedMult);
  }
}

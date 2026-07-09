import type { Ball } from '../entities/Ball';
import type { BotPlayer } from '../entities/BotPlayer';
import type { FormationPreset } from '../../lib/match/formations';
import type { SpawnAnchor, FieldRole } from '../config/spawnLayouts';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import {
  getBallController,
  getBallState,
  isBallControlledBy,
  isBallIdle,
} from './possession';
import { applyAntiStuck } from './antiStuck';
import { applySeparation, getBallApproachOffset, getSpeedVariance } from './separation';
import { executePass, findPassTarget } from '../actions/passing';

export const ENABLE_SIMPLE_PASS = true;

const BOT_SPEED = 187;
const PRESSURE_DISTANCE = 50;
const DEF_FORWARD_LIMIT = 0.55;
const BOT_PASS_COOLDOWN_MS = 1400;
const OWN_HALF_CLEAR_PRESSURE = 58;

const botPassCooldown = new WeakMap<BotPlayer, number>();

export type KickCallback = (side: 'home' | 'away', x: number, y: number) => void;
export type PassCallback = (side: 'home' | 'away', x: number, y: number, longPass?: boolean) => void;

type BotRole = 'presser' | 'supporter' | 'holder';

function getGoalX(side: 'home' | 'away'): number {
  return side === 'home' ? PITCH_WIDTH : 0;
}

function getOpponentGoalX(side: 'home' | 'away'): number {
  return getGoalX(side === 'home' ? 'away' : 'home');
}

function getOwnGoalX(side: 'home' | 'away'): number {
  return side === 'home' ? 0 : PITCH_WIDTH;
}

function isInOwnHalf(x: number, side: 'home' | 'away'): boolean {
  return side === 'home' ? x < PITCH_WIDTH / 2 : x > PITCH_WIDTH / 2;
}

function getBallTargetPoint(ball: Ball): { x: number; y: number } {
  const controller = getBallController();
  if (controller) return { x: controller.x, y: controller.y };
  return { x: ball.x, y: ball.y };
}

function findPresserIndex(bots: BotPlayer[], ball: Ball, side: 'home' | 'away'): number {
  const controller = getBallController();
  const ballPoint = getBallTargetPoint(ball);

  if (controller && controller.side !== side) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < bots.length; i++) {
      const dist = bots[i].distanceTo(controller.x, controller.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < bots.length; i++) {
    const dist = bots[i].distanceTo(ballPoint.x, ballPoint.y);
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
  const ballPoint = getBallTargetPoint(ball);
  let best = -1;
  let bestScore = Infinity;

  for (let i = 0; i < bots.length; i++) {
    if (i === presserIdx) continue;
    const bot = bots[i];
    const midX = (ballPoint.x + goalX) / 2;
    const midY = (ballPoint.y + goalY) / 2;
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
  const controller = getBallController();
  const presserIdx = findPresserIndex(bots, ball, side);
  const supporterIdx = findSupporterIndex(bots, ball, presserIdx, side);

  for (let i = 0; i < bots.length; i++) {
    if (controller && controller.side === side && i === presserIdx) {
      roles.set(i, 'supporter');
      continue;
    }
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
    const fwdOffsetY = (anchor.slot % 2 === 0 ? -1 : 1) * 35;
    if (side === 'home') {
      return { x: Math.max(targetX, minX), y: targetY + fwdOffsetY };
    }
    return { x: Math.min(targetX, minX), y: targetY + fwdOffsetY };
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

function tryDefensiveClear(
  bot: BotPlayer,
  ball: Ball,
  side: 'home' | 'away',
  time: number,
  onKick?: KickCallback,
  onPass?: PassCallback,
): boolean {
  const forward = side === 'home' ? 1 : -1;
  const clearY = bot.y + (Math.random() - 0.5) * 100;
  const clearTarget = {
    x: bot.x + forward * 260,
    y: Math.min(PITCH_HEIGHT - 80, Math.max(80, clearY)),
  };

  if (executePass(bot, ball, clearTarget, 'long', time)) {
    onPass?.(side, bot.x, bot.y, true);
    return true;
  }

  if (bot.kickBall(ball, true, time, 1.15)) {
    onKick?.(side, bot.x, bot.y);
    return true;
  }
  return false;
}

function tryBotPass(
  bot: BotPlayer,
  ball: Ball,
  teammates: BotPlayer[],
  opponents: BotPlayer[],
  side: 'home' | 'away',
  time: number,
  onPass?: PassCallback,
): boolean {
  if (!ENABLE_SIMPLE_PASS) return false;
  const lastPass = botPassCooldown.get(bot) ?? 0;
  if (time - lastPass < BOT_PASS_COOLDOWN_MS) return false;

  const target = findPassTarget(teammates, bot, opponents, 'short');
  if (!target) return false;

  const ownGoalX = getOwnGoalX(side);
  const towardOwn = Math.abs(target.x - ownGoalX) < Math.abs(bot.x - ownGoalX) - 20;
  if (towardOwn && isInOwnHalf(bot.x, side)) return false;

  if (executePass(bot, ball, target, 'short', time)) {
    botPassCooldown.set(bot, time);
    onPass?.(side, bot.x, bot.y);
    return true;
  }
  return false;
}

function handleBotWithBall(
  bot: BotPlayer,
  ball: Ball,
  teammates: BotPlayer[],
  side: 'home' | 'away',
  formation: FormationPreset,
  opponents: BotPlayer[],
  time: number,
  onKick?: KickCallback,
  onPass?: PassCallback,
): void {
  const goalX = getOpponentGoalX(side);
  const goalY = PITCH_HEIGHT / 2;
  const distToGoal = Math.abs(bot.x - goalX);
  const aligned = Math.abs(bot.y - goalY) < 120;
  const pressured = countNearbyOpponents(bot, opponents, PRESSURE_DISTANCE) > 0;
  const hasControl = isBallControlledBy(bot);
  const inDanger = isInOwnHalf(bot.x, side) && Math.abs(bot.x - getOwnGoalX(side)) < 280;

  if (!hasControl) return;

  if (inDanger && countNearbyOpponents(bot, opponents, OWN_HALF_CLEAR_PRESSURE) > 0) {
    if (tryDefensiveClear(bot, ball, side, time, onKick, onPass)) return;
  }

  if (distToGoal < formation.shootDistance && aligned) {
    if (bot.kickBall(ball, false, time)) {
      onKick?.(side, bot.x, bot.y);
    }
    return;
  }

  if (pressured) {
    if (inDanger) {
      if (tryDefensiveClear(bot, ball, side, time, onKick, onPass)) return;
    }
    if (tryBotPass(bot, ball, teammates, opponents, side, time, onPass)) return;
    if (bot.kickBall(ball, false, time, 1.05)) {
      onKick?.(side, bot.x, bot.y);
    }
    return;
  }

  if (tryBotPass(bot, ball, teammates, opponents, side, time, onPass)) return;

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
  onPass?: PassCallback,
): void {
  if (bots.length === 0) return;

  const state = getBallState();
  const controller = getBallController();
  const teammateControls = controller?.side === side;
  const roles = assignRoles(bots, ball, side);
  const goalX = getOpponentGoalX(side);
  const goalY = PITCH_HEIGHT / 2;
  const ballPoint = getBallTargetPoint(ball);

  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const anchor = anchors[bot.slot] ?? anchors[i];
    if (!anchor) continue;

    let role = roles.get(i) ?? 'holder';
    const speedMult = getSpeedVariance(bot.slot);

    if (teammateControls && role === 'presser') {
      role = 'supporter';
    }

    if (role === 'presser') {
      const hasBall =
        isBallControlledBy(bot) ||
        (bot.distanceTo(ball.x, ball.y) <= bot.kickRange && isBallIdle(ball) && state !== 'kicked');

      if (hasBall) {
        handleBotWithBall(bot, ball, bots, side, formation, opponents, time, onKick, onPass);
      } else if (state === 'free' || state === 'contested' || (controller && controller.side !== side)) {
        const offset = getBallApproachOffset(bot.slot);
        let targetX = ballPoint.x + offset.x;
        let targetY = ballPoint.y + offset.y;

        if (anchor.role === 'def') {
          const inOwnHalf =
            side === 'home' ? ball.x < PITCH_WIDTH / 2 : ball.x > PITCH_WIDTH / 2;
          if (!inOwnHalf) {
            const clamped = clampHolderTarget(anchor, anchor.x, anchor.y, side);
            targetX = clamped.x;
            targetY = clamped.y;
          }
        }

        const separated = applySeparation(bot, bots, targetX, targetY, opponents);
        const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
        const chaseSpeed = BOT_SPEED * (0.9 + formation.pressWeight * 0.15) * speedMult;
        bot.moveToward(unstuck.x, unstuck.y, chaseSpeed);
      } else {
        const shifted = shiftAnchorTowardBall(anchor, ball, side, formation.lineHeight);
        const clamped = clampHolderTarget(anchor, shifted.x, shifted.y, side);
        const separated = applySeparation(bot, bots, clamped.x, clamped.y, opponents);
        const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
        bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.75 * speedMult);
      }
      continue;
    }

    if (role === 'supporter') {
      const offset = getBallApproachOffset(bot.slot);
      let supportX = (ballPoint.x + goalX) / 2 + offset.x * 0.5;
      let supportY = (ballPoint.y + goalY) / 2 + offset.y * 0.5;

      if (teammateControls && controller) {
        supportX = controller.x + offset.x * 2;
        supportY = controller.y + offset.y * 2;
      }

      const separated = applySeparation(bot, bots, supportX, supportY, opponents);
      const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
      bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.85 * speedMult);
      continue;
    }

    const shifted = shiftAnchorTowardBall(anchor, ball, side, formation.lineHeight);
    const clamped = clampHolderTarget(anchor, shifted.x, shifted.y, side);
    const separated = applySeparation(bot, bots, clamped.x, clamped.y, opponents);
    const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
    bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.8 * speedMult);
  }
}

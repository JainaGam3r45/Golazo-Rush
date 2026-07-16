import type { Ball } from '../entities/Ball';
import type { BotPlayer } from '../entities/BotPlayer';
import type { FormationPreset } from '../../lib/match/formations';
import type { SpawnAnchor, FieldRole } from '../config/spawnLayouts';
import { PITCH_HEIGHT, PITCH_WIDTH, PITCH_MARGIN } from '../config/pitch';
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

const PLAYABLE_LEFT = PITCH_MARGIN;
const PLAYABLE_RIGHT = PITCH_WIDTH - PITCH_MARGIN;
const PLAYABLE_TOP = PITCH_MARGIN;
const PLAYABLE_BOTTOM = PITCH_HEIGHT - PITCH_MARGIN;
const AI_TARGET_INSET = 24;
const CARRY_Y_MARGIN = 72;
const TOUCHLINE_PASS_MARGIN = 70;
const BALL_OUT_LOOKAHEAD_S = 0.5;
const BALL_OUT_MIN_SPEED = 60;
const BALL_TOUCH_BAND = 90;

const botPassCooldown = new WeakMap<BotPlayer, number>();

function pointDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function clampToPlayable(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(PLAYABLE_RIGHT - AI_TARGET_INSET, Math.max(PLAYABLE_LEFT + AI_TARGET_INSET, x)),
    y: Math.min(PLAYABLE_BOTTOM - AI_TARGET_INSET, Math.max(PLAYABLE_TOP + AI_TARGET_INSET, y)),
  };
}

function clampCarryY(y: number): number {
  return Math.max(CARRY_Y_MARGIN, Math.min(PITCH_HEIGHT - CARRY_Y_MARGIN, y));
}

/** True when a loose ball is already out or clearly heading off the pitch. */
function ballHeadedOut(ball: Ball): boolean {
  if (
    ball.x <= PLAYABLE_LEFT ||
    ball.x >= PLAYABLE_RIGHT ||
    ball.y <= PLAYABLE_TOP ||
    ball.y >= PLAYABLE_BOTTOM
  ) {
    return true;
  }
  const vx = ball.body.velocity.x;
  const vy = ball.body.velocity.y;
  const speed = Math.hypot(vx, vy);
  if (speed < BALL_OUT_MIN_SPEED) return false;
  const px = ball.x + vx * BALL_OUT_LOOKAHEAD_S;
  const py = ball.y + vy * BALL_OUT_LOOKAHEAD_S;
  return (
    px <= PLAYABLE_LEFT ||
    px >= PLAYABLE_RIGHT ||
    py <= PLAYABLE_TOP ||
    py >= PLAYABLE_BOTTOM
  );
}

/** Carry toward goal with Y biased into space / toward a free forward teammate. */
function pickCarryTarget(
  bot: BotPlayer,
  teammates: BotPlayer[],
  opponents: BotPlayer[],
  side: 'home' | 'away',
): { x: number; y: number } {
  const goalX = getOpponentGoalX(side);
  const goalY = PITCH_HEIGHT / 2;
  const probeX = bot.x + (goalX - bot.x) * 0.45;

  const bands = [goalY - 100, goalY - 50, goalY, goalY + 50, goalY + 100];
  let bestY = goalY;
  let bestScore = -Infinity;
  for (const y of bands) {
    let nearestOpp = Infinity;
    for (const opp of opponents) {
      nearestOpp = Math.min(nearestOpp, pointDist(probeX, y, opp.x, opp.y));
    }
    const score = nearestOpp - Math.abs(y - goalY) * 0.08;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  let matePull = 0;
  let mateWeight = 0;
  for (const mate of teammates) {
    if (mate === bot) continue;
    const forward = side === 'home' ? mate.x > bot.x + 18 : mate.x < bot.x - 18;
    if (!forward) continue;
    const crowded = opponents.some((o) => pointDist(mate.x, mate.y, o.x, o.y) < 48);
    if (crowded) continue;
    matePull += mate.y - goalY;
    mateWeight += 1;
  }
  if (mateWeight > 0) {
    bestY += (matePull / mateWeight) * 0.4;
  }

  bestY += (bot.slot % 2 === 0 ? -1 : 1) * 12 + (bot.slot % 3) * 4;

  return { x: goalX, y: clampCarryY(bestY) };
}

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

function findSecondaryPresserIndex(
  bots: BotPlayer[],
  ball: Ball,
  primaryIdx: number,
): number {
  const ballPoint = getBallTargetPoint(ball);
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < bots.length; i++) {
    if (i === primaryIdx) continue;
    // Prefer midfielders / forwards as second presser; skip pure deep defenders when possible.
    if (bots.length > 6 && i < Math.floor(bots.length * 0.35)) continue;
    const dist = bots[i].distanceTo(ballPoint.x, ballPoint.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function assignRoles(
  bots: BotPlayer[],
  ball: Ball,
  side: 'home' | 'away',
  maxPressers = 1,
): Map<number, BotRole> {
  const roles = new Map<number, BotRole>();
  const controller = getBallController();
  const presserIdx = findPresserIndex(bots, ball, side);
  const supporterIdx = findSupporterIndex(bots, ball, presserIdx, side);
  const secondPresser =
    maxPressers > 1 ? findSecondaryPresserIndex(bots, ball, presserIdx) : -1;

  for (let i = 0; i < bots.length; i++) {
    if (controller && controller.side === side && (i === presserIdx || i === secondPresser)) {
      roles.set(i, 'supporter');
      continue;
    }
    if (i === presserIdx || i === secondPresser) {
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

  // Hold the anchor harder, and barely follow the ball when it hugs a touchline
  // so the line doesn't get dragged into the corner.
  const ballNearTouch = ball.y < BALL_TOUCH_BAND || ball.y > PITCH_HEIGHT - BALL_TOUCH_BAND;
  const shift = lineHeight * (ballNearTouch ? 22 : 45);
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
  const nearTouchline =
    bot.y < TOUCHLINE_PASS_MARGIN || bot.y > PITCH_HEIGHT - TOUCHLINE_PASS_MARGIN;

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

  // Hugging a touchline: look inside for a forward/central pass before carrying.
  if (nearTouchline) {
    if (tryBotPass(bot, ball, teammates, opponents, side, time, onPass)) return;
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

  const carry = pickCarryTarget(bot, teammates, opponents, side);
  bot.moveToward(carry.x, carry.y, BOT_SPEED * formation.pressWeight * getSpeedVariance(bot.slot));
}

export type BotUpdateOptions = {
  maxPressers?: number;
  softSeparation?: boolean;
};

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
  options: BotUpdateOptions = {},
): void {
  if (bots.length === 0) return;

  const maxPressers = options.maxPressers ?? 1;
  const softSeparation = Boolean(options.softSeparation);
  const state = getBallState();
  const controller = getBallController();
  const teammateControls = controller?.side === side;
  const roles = assignRoles(bots, ball, side, maxPressers);
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

    // Defenders hold the line unless they are the designated presser.
    if (anchor.role === 'def' && role === 'presser' && bots.length > 6) {
      const inOwnHalf =
        side === 'home' ? ball.x < PITCH_WIDTH / 2 : ball.x > PITCH_WIDTH / 2;
      if (!inOwnHalf) role = 'holder';
    }

    if (role === 'presser') {
      const hasBall =
        isBallControlledBy(bot) ||
        (bot.distanceTo(ball.x, ball.y) <= bot.kickRange && isBallIdle(ball) && state !== 'kicked');

      if (hasBall) {
        handleBotWithBall(bot, ball, bots, side, formation, opponents, time, onKick, onPass);
      } else if (!controller && ballHeadedOut(ball)) {
        // Loose ball leaving the pitch: recover the formation slot instead of
        // chasing it into the corner.
        const home = clampToPlayable(anchor.x, anchor.y);
        const separated = applySeparation(bot, bots, home.x, home.y, opponents, softSeparation);
        const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
        bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.8 * speedMult);
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

        const inField = clampToPlayable(targetX, targetY);
        const separated = applySeparation(bot, bots, inField.x, inField.y, opponents, softSeparation);
        const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
        const chaseSpeed = BOT_SPEED * (0.9 + formation.pressWeight * 0.15) * speedMult;
        bot.moveToward(unstuck.x, unstuck.y, chaseSpeed);
      } else {
        const shifted = shiftAnchorTowardBall(anchor, ball, side, formation.lineHeight);
        const clamped = clampHolderTarget(anchor, shifted.x, shifted.y, side);
        const separated = applySeparation(bot, bots, clamped.x, clamped.y, opponents, softSeparation);
        const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
        bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.75 * speedMult);
      }
      continue;
    }

    if (role === 'supporter') {
      const offset = getBallApproachOffset(bot.slot);
      // Half-moon lane: sit between ball and goal on a central band, fanned out
      // by slot, instead of gluing to ballY.
      const lane = ((bot.slot % 3) - 1) * 60;
      let supportX = (ballPoint.x + goalX) / 2 + offset.x * 0.5;
      let supportY = goalY + (ballPoint.y - goalY) * 0.35 + lane + offset.y * 0.5;

      if (teammateControls && controller) {
        supportX = controller.x + offset.x * 2;
        supportY = controller.y + offset.y * 2;
      }

      // Forwards look for space ahead of the ball rather than clustering.
      if (anchor.role === 'fwd') {
        const forward = side === 'home' ? 1 : -1;
        supportX = ballPoint.x + forward * 70 + offset.x;
        supportY = ballPoint.y + offset.y * 1.4;
      }

      const inField = clampToPlayable(supportX, supportY);
      const separated = applySeparation(bot, bots, inField.x, inField.y, opponents, softSeparation);
      const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
      bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.85 * speedMult);
      continue;
    }

    const shifted = shiftAnchorTowardBall(anchor, ball, side, formation.lineHeight);
    let holdX = shifted.x;
    let holdY = shifted.y;
    if (anchor.role === 'fwd') {
      const forward = side === 'home' ? 1 : -1;
      holdX = Math.max(0, Math.min(PITCH_WIDTH, shifted.x + forward * 24));
      holdY = shifted.y + ((anchor.slot % 2 === 0 ? -1 : 1) * 18);
    }
    const clamped = clampHolderTarget(anchor, holdX, holdY, side);
    const inField = clampToPlayable(clamped.x, clamped.y);
    const separated = applySeparation(bot, bots, inField.x, inField.y, opponents, softSeparation);
    const unstuck = applyAntiStuck(bot, separated.x, separated.y, time);
    bot.moveToward(unstuck.x, unstuck.y, BOT_SPEED * 0.8 * speedMult);
  }
}

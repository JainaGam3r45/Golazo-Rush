import type { FormationId, Side } from './types.ts';
import type { SimBall } from './ball.ts';
import { isBallIdle } from './ball.ts';
import type { SimPlayer } from './player.ts';
import { moveToward } from './player.ts';
import type { PossessionState } from './possession.ts';
import {
  BOT_SPEED,
  FORMATION_PRESS,
  GOALKEEPER_HOME_X,
  GOALKEEPER_AWAY_X,
  KICK_RANGE,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYABLE_LEFT,
  PLAYABLE_RIGHT,
  PLAYABLE_TOP,
  PLAYABLE_BOTTOM,
  clampGkY,
  dist,
  opponentGoalX,
  type SpawnAnchor,
} from './constants.ts';
import { executeClear, executePass, findPassTarget, kickBall, tryTackle } from './actions.ts';

type BotRole = 'presser' | 'supporter' | 'holder';

const PRESSURE_DISTANCE = 50;
const CLOSE_PRESSURE = 40;
/** Seconds of ball travel to chase when intercepting a free/moving ball. */
const INTERCEPT_LOOKAHEAD_S = 0.32;
const INTERCEPT_LOOKAHEAD_MAX_S = 0.48;
const CARRY_Y_MARGIN = 72;
/** Keep AI move targets inside the pitch so nobody chases a ball off the line. */
const AI_TARGET_INSET = 24;
/** A carrier this close to a touchline should look to pass inside first. */
const TOUCHLINE_PASS_MARGIN = 70;
/** How far ahead we project a loose ball to decide if it is leaving play. */
const BALL_OUT_LOOKAHEAD_S = 0.5;
const BALL_OUT_MIN_SPEED = 60;
/** Vertical band near a touchline where holders barely follow the ball. */
const BALL_TOUCH_BAND = 90;

const SLOT_SPEED = [1.0, 0.96, 1.04, 0.98, 1.02] as const;
const SLOT_APPROACH = [
  { x: -7, y: -5 },
  { x: 7, y: -5 },
  { x: -5, y: 7 },
  { x: 5, y: 7 },
  { x: 0, y: -8 },
] as const;

/** Soft per-bot decision stagger so presser/holder decisions don't fire in lockstep. */
const nextDecisionAt = new WeakMap<SimPlayer, number>();

function slotSpeed(slot: number): number {
  return SLOT_SPEED[slot % SLOT_SPEED.length] ?? 1;
}

function slotApproach(slot: number): { x: number; y: number } {
  return SLOT_APPROACH[slot % SLOT_APPROACH.length] ?? { x: 0, y: 0 };
}

function decisionReady(bot: SimPlayer, time: number): boolean {
  return time >= (nextDecisionAt.get(bot) ?? 0);
}

function markDecision(bot: SimPlayer, time: number): void {
  nextDecisionAt.set(bot, time + 28 + (bot.slot % 5) * 14);
}

function clampCarryY(y: number): number {
  return Math.max(CARRY_Y_MARGIN, Math.min(PITCH_HEIGHT - CARRY_Y_MARGIN, y));
}

/** Keep a movement target inside the playable rectangle. */
function clampToPlayable(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(PLAYABLE_RIGHT - AI_TARGET_INSET, Math.max(PLAYABLE_LEFT + AI_TARGET_INSET, x)),
    y: Math.min(PLAYABLE_BOTTOM - AI_TARGET_INSET, Math.max(PLAYABLE_TOP + AI_TARGET_INSET, y)),
  };
}

/** True when a loose ball is already out or clearly heading off the pitch. */
export function ballHeadedOut(ball: SimBall): boolean {
  if (
    ball.x <= PLAYABLE_LEFT ||
    ball.x >= PLAYABLE_RIGHT ||
    ball.y <= PLAYABLE_TOP ||
    ball.y >= PLAYABLE_BOTTOM
  ) {
    return true;
  }
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < BALL_OUT_MIN_SPEED) return false;
  const px = ball.x + ball.vx * BALL_OUT_LOOKAHEAD_S;
  const py = ball.y + ball.vy * BALL_OUT_LOOKAHEAD_S;
  return (
    px <= PLAYABLE_LEFT ||
    px >= PLAYABLE_RIGHT ||
    py <= PLAYABLE_TOP ||
    py >= PLAYABLE_BOTTOM
  );
}

function ballPoint(ball: SimBall, possession: PossessionState, players: SimPlayer[]): { x: number; y: number } {
  if (possession.controllerId) {
    const c = players.find((p) => p.id === possession.controllerId);
    if (c) return { x: c.x, y: c.y };
  }
  return { x: ball.x, y: ball.y };
}

/** Project where the ball will be so pressers intercept instead of chasing the trail. */
export function projectedInterceptPoint(
  ball: SimBall,
  chaser: SimPlayer,
  possession: PossessionState,
  players: SimPlayer[],
): { x: number; y: number } {
  const offset = slotApproach(chaser.slot);

  if (possession.controllerId) {
    const holder = players.find((p) => p.id === possession.controllerId);
    if (holder) {
      return clampToPlayable(holder.x + offset.x, holder.y + offset.y);
    }
  }

  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < 24) {
    return clampToPlayable(ball.x + offset.x, ball.y + offset.y);
  }

  const toBall = dist(chaser.x, chaser.y, ball.x, ball.y);
  const eta = toBall / Math.max(BOT_SPEED * slotSpeed(chaser.slot), 1);
  const look = Math.min(INTERCEPT_LOOKAHEAD_MAX_S, Math.max(INTERCEPT_LOOKAHEAD_S * 0.45, eta * 0.55));
  return clampToPlayable(
    ball.x + ball.vx * look + offset.x * 0.35,
    ball.y + ball.vy * look + offset.y * 0.35,
  );
}

/** Carry toward goal with Y biased into space / toward a free forward teammate. */
export function pickCarryTarget(
  bot: SimPlayer,
  teammates: SimPlayer[],
  opponents: SimPlayer[],
): { x: number; y: number } {
  const goalX = opponentGoalX(bot.side);
  const goalY = PITCH_HEIGHT / 2;
  const probeX = bot.x + (goalX - bot.x) * 0.45;

  const bands = [goalY - 100, goalY - 50, goalY, goalY + 50, goalY + 100];
  let bestY = goalY;
  let bestScore = -Infinity;
  for (const y of bands) {
    let nearestOpp = Infinity;
    for (const opp of opponents) {
      nearestOpp = Math.min(nearestOpp, dist(probeX, y, opp.x, opp.y));
    }
    const centerPull = -Math.abs(y - goalY) * 0.08;
    const score = nearestOpp + centerPull;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  let matePull = 0;
  let mateWeight = 0;
  for (const mate of teammates) {
    if (mate.id === bot.id || mate.role === 'gk') continue;
    const forward =
      bot.side === 'home' ? mate.x > bot.x + 18 : mate.x < bot.x - 18;
    if (!forward) continue;
    const crowded = opponents.some((o) => dist(mate.x, mate.y, o.x, o.y) < 48);
    if (crowded) continue;
    matePull += mate.y - goalY;
    mateWeight += 1;
  }
  if (mateWeight > 0) {
    bestY += (matePull / mateWeight) * 0.4;
  }

  // Slot skew so identical bots don't share one run lane.
  bestY += ((bot.slot % 2 === 0 ? -1 : 1) * 12) + (bot.slot % 3) * 4;

  return { x: goalX, y: clampCarryY(bestY) };
}

function nearestOpponentDist(bot: SimPlayer, opponents: SimPlayer[]): number {
  let best = Infinity;
  for (const opp of opponents) {
    best = Math.min(best, dist(bot.x, bot.y, opp.x, opp.y));
  }
  return best;
}

function assignRoles(bots: SimPlayer[], ball: SimBall, possession: PossessionState, players: SimPlayer[]): Map<string, BotRole> {
  const roles = new Map<string, BotRole>();
  if (bots.length === 0) return roles;

  const point = ballPoint(ball, possession, players);
  let presser = bots[0];
  let best = Infinity;
  for (const bot of bots) {
    const d = dist(bot.x, bot.y, point.x, point.y);
    if (d < best) {
      best = d;
      presser = bot;
    }
  }

  const goalX = opponentGoalX(bots[0].side);
  let supporter: SimPlayer | null = null;
  let supportBest = Infinity;
  for (const bot of bots) {
    if (bot.id === presser.id) continue;
    const midX = (point.x + goalX) / 2;
    const midY = (point.y + PITCH_HEIGHT / 2) / 2;
    const d = dist(bot.x, bot.y, midX, midY);
    if (d < supportBest) {
      supportBest = d;
      supporter = bot;
    }
  }

  for (const bot of bots) {
    if (bot.id === presser.id) roles.set(bot.id, 'presser');
    else if (supporter && bot.id === supporter.id) roles.set(bot.id, 'supporter');
    else roles.set(bot.id, 'holder');
  }
  return roles;
}

function handleWithBall(
  bot: SimPlayer,
  ball: SimBall,
  possession: PossessionState,
  teammates: SimPlayer[],
  opponents: SimPlayer[],
  formationId: FormationId,
  time: number,
): void {
  if (possession.controllerId !== bot.id) return;

  const preset = FORMATION_PRESS[formationId];
  const goalX = opponentGoalX(bot.side);
  const carry = pickCarryTarget(bot, teammates, opponents);
  const distToGoal = Math.abs(bot.x - goalX);
  const aligned = Math.abs(bot.y - carry.y) < 130;
  const nearest = nearestOpponentDist(bot, opponents);
  const closePressure = nearest < CLOSE_PRESSURE;
  const pressured = nearest < PRESSURE_DISTANCE;
  const canDecide = decisionReady(bot, time);
  const nearTouchline =
    bot.y < TOUCHLINE_PASS_MARGIN || bot.y > PITCH_HEIGHT - TOUCHLINE_PASS_MARGIN;

  if (canDecide && distToGoal < preset.shootDistance && aligned && !closePressure) {
    if (kickBall(bot, ball, possession, time, false)) {
      markDecision(bot, time);
      return;
    }
  }

  // Hugging a touchline: look inside for a forward/central pass before carrying.
  if (canDecide && nearTouchline) {
    const target = findPassTarget(bot, teammates, opponents);
    if (target && executePass(bot, ball, target, possession, time)) {
      markDecision(bot, time);
      return;
    }
  }

  // Under close pressure, prefer a pass over carrying or a panic shot.
  if (closePressure) {
    if (canDecide) {
      const target = findPassTarget(bot, teammates, opponents);
      if (target && executePass(bot, ball, target, possession, time)) {
        markDecision(bot, time);
        return;
      }
      if (kickBall(bot, ball, possession, time, false, 1.05)) {
        markDecision(bot, time);
        return;
      }
    }
    moveToward(bot, carry.x, carry.y, BOT_SPEED * preset.pressWeight * slotSpeed(bot.slot) * 0.92);
    return;
  }

  if (pressured && canDecide) {
    const target = findPassTarget(bot, teammates, opponents);
    if (target && executePass(bot, ball, target, possession, time)) {
      markDecision(bot, time);
      return;
    }
  }

  if (canDecide) {
    const target = findPassTarget(bot, teammates, opponents);
    if (target && executePass(bot, ball, target, possession, time)) {
      markDecision(bot, time);
      return;
    }
  }

  moveToward(bot, carry.x, carry.y, BOT_SPEED * preset.pressWeight * slotSpeed(bot.slot));
}

export function updateBots(
  bots: SimPlayer[],
  ball: SimBall,
  possession: PossessionState,
  players: SimPlayer[],
  anchors: SpawnAnchor[],
  formationId: FormationId,
  side: Side,
  time: number,
): void {
  if (bots.length === 0) return;

  const teammates = players.filter((p) => p.side === side);
  const opponents = players.filter((p) => p.side !== side);
  const roles = assignRoles(bots, ball, possession, players);
  const point = ballPoint(ball, possession, players);
  const goalX = opponentGoalX(side);
  const preset = FORMATION_PRESS[formationId];
  const teammateControls = possession.controllerId
    ? players.find((p) => p.id === possession.controllerId)?.side === side
    : false;

  for (const bot of bots) {
    let role = roles.get(bot.id) ?? 'holder';
    if (teammateControls && role === 'presser') role = 'supporter';

    const anchor = anchors[bot.slot] ?? anchors[0];
    if (!anchor) continue;
    const speedMul = slotSpeed(bot.slot);

    if (possession.controllerId === bot.id) {
      handleWithBall(bot, ball, possession, teammates, opponents, formationId, time);
      continue;
    }

    if (role === 'presser') {
      if (
        decisionReady(bot, time) &&
        tryTackle(bot, ball, possession, players, time)
      ) {
        markDecision(bot, time);
        continue;
      }

      // Loose ball leaving the pitch: let it go and reclaim the formation slot.
      if (!possession.controllerId && ballHeadedOut(ball)) {
        const home = clampToPlayable(anchor.x, anchor.y);
        moveToward(bot, home.x, home.y, BOT_SPEED * 0.8 * speedMul);
        continue;
      }

      const nearBall =
        dist(bot.x, bot.y, ball.x, ball.y) <= KICK_RANGE &&
        isBallIdle(ball) &&
        possession.ballState !== 'kicked';
      if (nearBall) {
        handleWithBall(bot, ball, possession, teammates, opponents, formationId, time);
      } else {
        const chase = projectedInterceptPoint(ball, bot, possession, players);
        moveToward(bot, chase.x, chase.y, BOT_SPEED * (0.9 + preset.pressWeight * 0.15) * speedMul);
      }
      continue;
    }

    if (role === 'supporter') {
      const offset = slotApproach(bot.slot);
      // Half-moon lane: sit between ball and goal, hold a central band rather
      // than tracking ballY, and fan out across lanes by slot.
      const lane = ((bot.slot % 3) - 1) * 60;
      const supportX = (point.x + goalX) / 2 + offset.x * 0.5;
      const supportY =
        PITCH_HEIGHT / 2 + (point.y - PITCH_HEIGHT / 2) * 0.35 + lane + offset.y * 0.5;
      const support = clampToPlayable(supportX, supportY);
      moveToward(bot, support.x, support.y, BOT_SPEED * 0.85 * speedMul);
      continue;
    }

    const line = preset.lineHeight;
    const ballNearTouch =
      point.y < BALL_TOUCH_BAND || point.y > PITCH_HEIGHT - BALL_TOUCH_BAND;
    const holdX = anchor.x + (point.x - PITCH_WIDTH / 2) * line * 0.12;
    const holdY = anchor.y + (point.y - PITCH_HEIGHT / 2) * (ballNearTouch ? 0.02 : 0.06);
    const hold = clampToPlayable(holdX, holdY);
    moveToward(bot, hold.x, hold.y, BOT_SPEED * 0.8 * speedMul);
  }
}

export function updateGoalkeeper(
  gk: SimPlayer,
  ball: SimBall,
  possession: PossessionState,
  time: number,
  opponents: SimPlayer[],
): void {
  const homeX = gk.side === 'home' ? GOALKEEPER_HOME_X : GOALKEEPER_AWAY_X;
  const ballSpeed = Math.hypot(ball.vx, ball.vy);
  let predictedY = ball.y;
  const inOwnHalf = gk.side === 'home' ? ball.x < homeX + 120 : ball.x > homeX - 120;

  if (inOwnHalf && ballSpeed > 30) {
    const timeToReach = Math.abs(ball.x - homeX) / Math.max(Math.abs(ball.vx), 1);
    predictedY = ball.y + ball.vy * timeToReach * 0.35;
  }

  const targetY = clampGkY(predictedY);
  const zoneX =
    gk.side === 'home'
      ? Math.min(homeX + 40, homeX + (ball.x - homeX) * 0.15)
      : Math.max(homeX - 40, homeX + (ball.x - homeX) * 0.15);

  moveToward(gk, zoneX, targetY);

  if (!inOwnHalf) return;

  const d = dist(gk.x, gk.y, ball.x, ball.y);
  const loose =
    d <= KICK_RANGE + 10 &&
    (isBallIdle(ball) || ballSpeed < 90) &&
    possession.ballState !== 'kicked' &&
    (possession.controllerId === gk.id ||
      possession.ballState === 'free' ||
      possession.ballState === 'contested');

  if (!loose && !(d <= KICK_RANGE + 4 && possession.controllerId === gk.id)) return;

  const forward = gk.side === 'home' ? 1 : -1;
  const clearTarget = { x: gk.x + forward * 280, y: PITCH_HEIGHT / 2 };
  const pressured = opponents.some((o) => dist(gk.x, gk.y, o.x, o.y) < 55);

  if (pressured || loose) {
    if (executePass(gk, ball, clearTarget, possession, time, true)) return;
    executeClear(gk, ball, possession, time);
  }
}

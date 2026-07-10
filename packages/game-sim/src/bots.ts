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
  clampGkY,
  dist,
  opponentGoalX,
  type SpawnAnchor,
} from './constants.ts';
import { executeClear, executePass, findPassTarget, kickBall } from './actions.ts';

type BotRole = 'presser' | 'supporter' | 'holder';

function ballPoint(ball: SimBall, possession: PossessionState, players: SimPlayer[]): { x: number; y: number } {
  if (possession.controllerId) {
    const c = players.find((p) => p.id === possession.controllerId);
    if (c) return { x: c.x, y: c.y };
  }
  return { x: ball.x, y: ball.y };
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
  const goalY = PITCH_HEIGHT / 2;
  const distToGoal = Math.abs(bot.x - goalX);
  const aligned = Math.abs(bot.y - goalY) < 120;
  const pressured = opponents.some((o) => dist(bot.x, bot.y, o.x, o.y) < 50);

  if (distToGoal < preset.shootDistance && aligned) {
    kickBall(bot, ball, possession, time, false);
    return;
  }

  if (pressured) {
    const target = findPassTarget(bot, teammates, opponents);
    if (target && executePass(bot, ball, target, possession, time)) return;
    kickBall(bot, ball, possession, time, false, 1.05);
    return;
  }

  const target = findPassTarget(bot, teammates, opponents);
  if (target && executePass(bot, ball, target, possession, time)) return;
  moveToward(bot, goalX, goalY, BOT_SPEED * preset.pressWeight);
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

    if (possession.controllerId === bot.id) {
      handleWithBall(bot, ball, possession, teammates, opponents, formationId, time);
      continue;
    }

    if (role === 'presser') {
      const nearBall =
        dist(bot.x, bot.y, ball.x, ball.y) <= KICK_RANGE &&
        isBallIdle(ball) &&
        possession.ballState !== 'kicked';
      if (nearBall) {
        handleWithBall(bot, ball, possession, teammates, opponents, formationId, time);
      } else {
        moveToward(bot, point.x, point.y, BOT_SPEED * (0.9 + preset.pressWeight * 0.15));
      }
      continue;
    }

    if (role === 'supporter') {
      const supportX = (point.x + goalX) / 2;
      const supportY = (point.y + PITCH_HEIGHT / 2) / 2;
      moveToward(bot, supportX, supportY, BOT_SPEED * 0.85);
      continue;
    }

    const line = preset.lineHeight;
    const holdX = anchor.x + (point.x - PITCH_WIDTH / 2) * line * 0.15;
    const holdY = anchor.y + (point.y - PITCH_HEIGHT / 2) * 0.08;
    moveToward(bot, holdX, holdY, BOT_SPEED * 0.8);
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

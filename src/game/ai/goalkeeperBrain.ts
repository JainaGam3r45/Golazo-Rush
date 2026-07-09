import type { Ball } from '../entities/Ball';
import type { Goalkeeper } from '../entities/Goalkeeper';
import { KICK_RANGE } from '../entities/FieldPlayer';
import type { KickCallback } from './botBrain';
import { isBallControlledBy, isBallIdle, getBallState } from './possession';
import { executePass } from '../actions/passing';
import type { BotPlayer } from '../entities/BotPlayer';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

const ZONE_LIMIT = 40;
const PREDICTION_FACTOR = 0.35;
const LOOSE_BALL_SPEED = 90;

function safeClearTarget(gk: Goalkeeper): { x: number; y: number } {
  const forward = gk.side === 'home' ? 1 : -1;
  const nearEndline =
    gk.side === 'home' ? gk.x < 100 : gk.x > PITCH_WIDTH - 100;

  let yOffset = (Math.random() - 0.5) * 90;
  if (nearEndline) {
    yOffset = Math.abs(yOffset) * (gk.y < PITCH_HEIGHT / 2 ? 1 : -1);
  }

  const targetY = Math.min(PITCH_HEIGHT - 90, Math.max(90, gk.y + yOffset));
  return {
    x: gk.x + forward * (nearEndline ? 320 : 280),
    y: targetY,
  };
}

export function updateGoalkeeper(
  gk: Goalkeeper,
  ball: Ball,
  time: number,
  onKick?: KickCallback,
  opponents: BotPlayer[] = [],
): void {
  const ballSpeed = Math.sqrt(ball.body.velocity.x ** 2 + ball.body.velocity.y ** 2);
  let predictedY = ball.y;

  const inOwnHalf =
    gk.side === 'home' ? ball.x < gk.x + 120 : ball.x > gk.x - 120;

  if (inOwnHalf && ballSpeed > 30) {
    const timeToReach = Math.abs(ball.x - gk.homeX) / Math.max(Math.abs(ball.body.velocity.x), 1);
    predictedY = ball.y + ball.body.velocity.y * timeToReach * PREDICTION_FACTOR;
  }

  const targetY = gk.clampY(predictedY);
  const zoneX = gk.side === 'home'
    ? Math.min(gk.homeX + ZONE_LIMIT, gk.homeX + (ball.x - gk.homeX) * 0.15)
    : Math.max(gk.homeX - ZONE_LIMIT, gk.homeX + (ball.x - gk.homeX) * 0.15);

  gk.moveToward(zoneX, targetY);

  if (!inOwnHalf) return;

  const dist = gk.distanceTo(ball.x, ball.y);
  const state = getBallState();
  const looseInBox =
    dist <= KICK_RANGE + 10 &&
    (isBallIdle(ball) || ballSpeed < LOOSE_BALL_SPEED) &&
    state !== 'kicked' &&
    (isBallControlledBy(gk) || state === 'free' || state === 'contested');

  if (!looseInBox && !(dist <= KICK_RANGE + 4 && isBallControlledBy(gk))) {
    return;
  }

  const clearTarget = safeClearTarget(gk);
  const pressured = opponents.some((o) => gk.distanceTo(o.x, o.y) < 55);

  if (pressured || looseInBox) {
    if (executePass(gk, ball, clearTarget, 'long', time)) {
      onKick?.(gk.side, gk.x, gk.y);
      return;
    }
  }

  const clearDx = clearTarget.x - gk.x;
  const clearDy = clearTarget.y - gk.y;
  const clearLen = Math.sqrt(clearDx * clearDx + clearDy * clearDy) || 1;
  if (gk.kickBall(ball, false, time, 1.2, {
    x: clearDx / clearLen,
    y: clearDy / clearLen,
  })) {
    onKick?.(gk.side, gk.x, gk.y);
  }
}

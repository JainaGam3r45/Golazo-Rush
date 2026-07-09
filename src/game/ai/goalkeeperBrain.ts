import type { Ball } from '../entities/Ball';
import type { Goalkeeper } from '../entities/Goalkeeper';
import { KICK_RANGE } from '../entities/FieldPlayer';
import type { KickCallback } from './botBrain';

const ZONE_LIMIT = 40;
const PREDICTION_FACTOR = 0.35;

export function updateGoalkeeper(
  gk: Goalkeeper,
  ball: Ball,
  time: number,
  onKick?: KickCallback,
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
  if (dist <= KICK_RANGE + 4) {
    if (gk.kickBall(ball, false, time, 1.2)) {
      onKick?.(gk.side, gk.x, gk.y);
    }
  }
}

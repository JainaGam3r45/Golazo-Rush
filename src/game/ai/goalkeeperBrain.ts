import type { Ball } from '../entities/Ball';
import type { Goalkeeper } from '../entities/Goalkeeper';
import { KICK_RANGE } from '../entities/FieldPlayer';

const CLEAR_FORCE = 420;

export function updateGoalkeeper(gk: Goalkeeper, ball: Ball, time: number): void {
  const targetY = gk.clampY(ball.y);
  gk.moveToward(gk.homeX, targetY);

  const inOwnHalf =
    gk.side === 'home' ? ball.x < gk.x + 80 : ball.x > gk.x - 80;
  if (!inOwnHalf) return;

  const dist = gk.distanceTo(ball.x, ball.y);
  if (dist <= KICK_RANGE + 4) {
    const towardCenterY = ball.y < gk.y ? gk.yMax : gk.yMin;
    const dx = gk.side === 'home' ? 1 : -1;
    ball.setPosition(ball.x + dx * 8, ball.y);
    ball.body.setVelocity(dx * CLEAR_FORCE, (towardCenterY - ball.y) * 2.5);
    gk.markKicked(time);
  }
}

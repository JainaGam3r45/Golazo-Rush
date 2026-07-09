import type { Ball } from '../entities/Ball';
import type { BotPlayer } from '../entities/BotPlayer';
import type { FormationPreset } from '../../lib/match/formations';
import type { SpawnAnchor } from '../config/spawnLayouts';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

const BALL_IDLE_SPEED = 45;
const CHASE_BLEND = 0.35;
const BOT_SPEED = 187;

function ballIsIdle(ball: Ball): boolean {
  const speed = Math.sqrt(ball.body.velocity.x ** 2 + ball.body.velocity.y ** 2);
  return speed < BALL_IDLE_SPEED;
}

function getGoalX(side: 'home' | 'away'): number {
  return side === 'home' ? PITCH_WIDTH : 0;
}

function findChaserIndex(bots: BotPlayer[], ball: Ball): number {
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

export function updateTeamBots(
  bots: BotPlayer[],
  ball: Ball,
  anchors: SpawnAnchor[],
  formation: FormationPreset,
  side: 'home' | 'away',
  time: number,
): void {
  if (bots.length === 0) return;

  const chaserIdx = findChaserIndex(bots, ball);
  const goalX = getGoalX(side === 'home' ? 'away' : 'home');
  const goalY = PITCH_HEIGHT / 2;

  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const anchor = anchors[bot.slot] ?? anchors[i];
    if (!anchor) continue;

    if (i === chaserIdx) {
      const distToBall = bot.distanceTo(ball.x, ball.y);
      const hasBall = distToBall <= bot.kickRange && ballIsIdle(ball);

      if (hasBall) {
        bot.moveToward(goalX, goalY, BOT_SPEED * formation.pressWeight);
        const distToGoal = Math.abs(bot.x - goalX);
        const aligned = Math.abs(bot.y - goalY) < 120;
        if (distToGoal < formation.shootDistance && aligned) {
          bot.kickBall(ball, false, time);
        }
      } else {
        const chaseSpeed = BOT_SPEED * (0.9 + formation.pressWeight * 0.15);
        bot.moveToward(ball.x, ball.y, chaseSpeed);
      }
      continue;
    }

    const target = shiftAnchorTowardBall(anchor, ball, side, formation.lineHeight);
    const blendX = target.x + (ball.x - target.x) * CHASE_BLEND * formation.pressWeight * 0.15;
    const blendY = target.y + (ball.y - target.y) * CHASE_BLEND * formation.pressWeight * 0.1;
    bot.moveToward(blendX, blendY);
  }
}

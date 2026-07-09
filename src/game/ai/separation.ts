import type { BotPlayer } from '../entities/BotPlayer';

const SEPARATION_RADIUS = 36;
const SEPARATION_FORCE = 28;
const OPPONENT_SEP_RADIUS = 28;
const OPPONENT_SEP_FORCE = 14;

const SLOT_SPEED_VARIANCE = [1.0, 0.96, 1.04, 0.98];
const SLOT_BALL_OFFSETS = [
  { x: -8, y: -6 },
  { x: 8, y: -6 },
  { x: -6, y: 8 },
  { x: 6, y: 8 },
];

export function getSpeedVariance(slot: number): number {
  return SLOT_SPEED_VARIANCE[slot % SLOT_SPEED_VARIANCE.length] ?? 1;
}

export function getBallApproachOffset(slot: number): { x: number; y: number } {
  return SLOT_BALL_OFFSETS[slot % SLOT_BALL_OFFSETS.length] ?? { x: 0, y: 0 };
}

export function applySeparation(
  bot: BotPlayer,
  teammates: BotPlayer[],
  targetX: number,
  targetY: number,
  opponents: BotPlayer[] = [],
): { x: number; y: number } {
  let pushX = 0;
  let pushY = 0;

  for (const other of teammates) {
    if (other === bot) continue;
    const dx = bot.x - other.x;
    const dy = bot.y - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0 && dist < SEPARATION_RADIUS) {
      const strength = (SEPARATION_RADIUS - dist) / SEPARATION_RADIUS;
      pushX += (dx / dist) * SEPARATION_FORCE * strength;
      pushY += (dy / dist) * SEPARATION_FORCE * strength;
    }
  }

  for (const opp of opponents) {
    const dx = bot.x - opp.x;
    const dy = bot.y - opp.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0 && dist < OPPONENT_SEP_RADIUS) {
      const strength = (OPPONENT_SEP_RADIUS - dist) / OPPONENT_SEP_RADIUS;
      pushX += (dx / dist) * OPPONENT_SEP_FORCE * strength;
      pushY += (dy / dist) * OPPONENT_SEP_FORCE * strength;
    }
  }

  return { x: targetX + pushX, y: targetY + pushY };
}

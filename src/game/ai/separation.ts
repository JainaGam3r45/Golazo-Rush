import type { BotPlayer } from '../entities/BotPlayer';

const SEPARATION_RADIUS = 40;
const SEPARATION_FORCE = 34;
const OPPONENT_SEP_RADIUS = 32;
const OPPONENT_SEP_FORCE = 18;

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
  soft = false,
): { x: number; y: number } {
  let pushX = 0;
  let pushY = 0;
  const teamForce = soft ? SEPARATION_FORCE * 0.55 : SEPARATION_FORCE;
  const teamRadius = soft ? SEPARATION_RADIUS * 0.85 : SEPARATION_RADIUS;
  const oppForce = soft ? OPPONENT_SEP_FORCE * 0.4 : OPPONENT_SEP_FORCE;
  const oppRadius = soft ? OPPONENT_SEP_RADIUS * 0.75 : OPPONENT_SEP_RADIUS;

  for (const other of teammates) {
    if (other === bot) continue;
    const dx = bot.x - other.x;
    const dy = bot.y - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0 && dist < teamRadius) {
      const strength = (teamRadius - dist) / teamRadius;
      pushX += (dx / dist) * teamForce * strength;
      pushY += (dy / dist) * teamForce * strength;
    }
  }

  for (const opp of opponents) {
    const dx = bot.x - opp.x;
    const dy = bot.y - opp.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0 && dist < oppRadius) {
      const strength = (oppRadius - dist) / oppRadius;
      pushX += (dx / dist) * oppForce * strength;
      pushY += (dy / dist) * oppForce * strength;
    }
  }

  return { x: targetX + pushX, y: targetY + pushY };
}

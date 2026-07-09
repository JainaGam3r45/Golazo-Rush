import type { BotPlayer } from '../entities/BotPlayer';

const SAMPLE_INTERVAL_MS = 500;
const STUCK_WINDOW_MS = 2500;
const STUCK_DISTANCE_PX = 12;
const RECOVERY_OFFSET_PX = 70;
const ALT_TARGET_BLOCK_MS = 2000;

type StuckSample = { x: number; y: number; time: number };
type AltTarget = { x: number; y: number; until: number };

const samples = new WeakMap<BotPlayer, StuckSample[]>();
const recoveryUntil = new WeakMap<BotPlayer, number>();
const recoveryOffset = new WeakMap<BotPlayer, number>();
const lastAltTarget = new WeakMap<BotPlayer, AltTarget>();

function getSlotOffset(slot: number): number {
  return slot % 2 === 0 ? RECOVERY_OFFSET_PX : -RECOVERY_OFFSET_PX;
}

export function resetAntiStuck(bot: BotPlayer): void {
  samples.delete(bot);
  recoveryUntil.delete(bot);
  recoveryOffset.delete(bot);
  lastAltTarget.delete(bot);
}

export function sampleBotPosition(bot: BotPlayer, time: number): void {
  const history = samples.get(bot) ?? [];
  const last = history[history.length - 1];

  if (last && time - last.time < SAMPLE_INTERVAL_MS) return;

  history.push({ x: bot.x, y: bot.y, time });
  const cutoff = time - STUCK_WINDOW_MS;
  while (history.length > 0 && history[0].time < cutoff) {
    history.shift();
  }
  samples.set(bot, history);
}

function isStuck(bot: BotPlayer, time: number): boolean {
  const history = samples.get(bot);
  if (!history || history.length < 2) return false;

  const oldest = history[0];
  if (time - oldest.time < STUCK_WINDOW_MS - SAMPLE_INTERVAL_MS) return false;

  const dx = bot.x - oldest.x;
  const dy = bot.y - oldest.y;
  return Math.sqrt(dx * dx + dy * dy) < STUCK_DISTANCE_PX;
}

function pickAltTarget(targetX: number, targetY: number, bot: BotPlayer, time: number): { x: number; y: number } {
  const prev = lastAltTarget.get(bot);
  if (prev && time < prev.until) {
    const sameSpot = Math.abs(prev.x - targetX) < 8 && Math.abs(prev.y - targetY) < 8;
    if (sameSpot) {
      const offset = getSlotOffset(bot.slot + 1);
      return { x: targetX + offset, y: targetY + offset * 0.4 };
    }
  }
  return { x: targetX, y: targetY };
}

export function applyAntiStuck(
  bot: BotPlayer,
  targetX: number,
  targetY: number,
  time: number,
): { x: number; y: number } {
  sampleBotPosition(bot, time);

  const recovering = recoveryUntil.get(bot);
  if (recovering && time < recovering) {
    const offset = recoveryOffset.get(bot) ?? 0;
    const alt = pickAltTarget(targetX + offset, targetY, bot, time);
    return alt;
  }

  if (isStuck(bot, time)) {
    const offset = getSlotOffset(bot.slot);
    recoveryOffset.set(bot, offset);
    recoveryUntil.set(bot, time + 1200);
    samples.set(bot, []);

    const altX = targetX + offset;
    const altY = targetY + offset * 0.35;
    lastAltTarget.set(bot, { x: altX, y: altY, until: time + ALT_TARGET_BLOCK_MS });
    return { x: altX, y: altY };
  }

  return { x: targetX, y: targetY };
}

import Phaser from 'phaser';
import { FieldPlayer } from './FieldPlayer';
import { BOT_KICK_COOLDOWN_MS } from './FieldPlayer';

const BOT_SPEED_BASE = 187;
const SLOT_SPEED = [1.0, 0.96, 1.04, 0.98];

export class BotPlayer extends FieldPlayer {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    teamColor: number,
    side: 'home' | 'away',
    slot: number,
    kind: 'teammate' | 'opponent',
    scale = 1,
  ) {
    const speedMult = SLOT_SPEED[slot % SLOT_SPEED.length] ?? 1;
    super(scene, x, y, {
      teamColor,
      side,
      kind,
      slot,
      maxSpeed: BOT_SPEED_BASE * speedMult,
      scale,
      strokeAlpha: kind === 'teammate' ? 0.45 : 0.7,
      kickCooldownMs: BOT_KICK_COOLDOWN_MS,
    });
  }
}

import { FieldPlayer } from './FieldPlayer';

const BOT_SPEED = 187;

export class BotPlayer extends FieldPlayer {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    teamColor: number,
    side: 'home' | 'away',
    slot: number,
    kind: 'teammate' | 'opponent',
  ) {
    super(scene, x, y, {
      teamColor,
      side,
      kind,
      slot,
      maxSpeed: BOT_SPEED,
      strokeAlpha: kind === 'teammate' ? 0.45 : 0.7,
    });
  }
}

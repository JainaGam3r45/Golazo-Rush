import Phaser from 'phaser';
import { FieldPlayer } from './FieldPlayer';
import { GK_KICK_COOLDOWN_MS } from './FieldPlayer';
import {
  GOALKEEPER_HOME_X,
  GOALKEEPER_AWAY_X,
  GOALKEEPER_Y_MAX,
  GOALKEEPER_Y_MIN,
} from '../config/pitch';

const GK_SPEED = 160;
const GK_SIZE = 32;

export class Goalkeeper extends FieldPlayer {
  readonly homeX: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    teamColor: number,
    side: 'home' | 'away',
    kind: 'teammate' | 'opponent',
    scale = 1,
  ) {
    const darkerColor = Goalkeeper.darkenColor(teamColor);
    super(scene, x, y, {
      teamColor: darkerColor,
      side,
      kind,
      slot: -1,
      maxSpeed: GK_SPEED,
      width: GK_SIZE,
      height: GK_SIZE,
      scale,
      strokeAlpha: 0.85,
      kickCooldownMs: GK_KICK_COOLDOWN_MS,
      visualKind: 'goalkeeper',
    });
    this.homeX = side === 'home' ? GOALKEEPER_HOME_X : GOALKEEPER_AWAY_X;
    this.setDepth(2);
    this.shadow.setScale(1.15, 1.1);
  }

  private static darkenColor(color: number): number {
    const r = Math.max(0, ((color >> 16) & 0xff) - 40);
    const g = Math.max(0, ((color >> 8) & 0xff) - 40);
    const b = Math.max(0, (color & 0xff) - 40);
    return (r << 16) | (g << 8) | b;
  }

  clampY(y: number): number {
    return Phaser.Math.Clamp(y, GOALKEEPER_Y_MIN, GOALKEEPER_Y_MAX);
  }

  get yMin(): number {
    return GOALKEEPER_Y_MIN;
  }

  get yMax(): number {
    return GOALKEEPER_Y_MAX;
  }
}

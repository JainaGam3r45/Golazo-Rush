import Phaser from 'phaser';
import type { FieldPlayerKind } from './FieldPlayer';

const ACCENT_COLOR = 0x39ff14;

export type PlayerVisualOptions = {
  teamColor: number;
  kind: FieldPlayerKind | 'goalkeeper';
  slot: number;
  width: number;
  height: number;
};

export class PlayerVisual {
  readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly bodyShape: Phaser.GameObjects.Graphics;
  private readonly numberText: Phaser.GameObjects.Text;
  private readonly accentRing?: Phaser.GameObjects.Arc;
  private readonly gloveLeft?: Phaser.GameObjects.Arc;
  private readonly gloveRight?: Phaser.GameObjects.Arc;
  private readonly kind: PlayerVisualOptions['kind'];
  private readonly baseWidth: number;
  private readonly baseHeight: number;

  constructor(scene: Phaser.Scene, x: number, y: number, options: PlayerVisualOptions) {
    this.kind = options.kind;
    this.baseWidth = options.width;
    this.baseHeight = options.height;

    this.shadow = scene.add.ellipse(0, options.height * 0.38, options.width * 0.95, options.height * 0.32, 0x000000, 0.28);
    this.bodyShape = scene.add.graphics();
    this.numberText = scene.add
      .text(0, 0, options.slot >= 0 ? String(options.slot + 1) : 'GK', {
        fontFamily: 'Inter, sans-serif',
        fontSize: options.kind === 'goalkeeper' ? '11px' : '10px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [this.shadow, this.bodyShape, this.numberText];

    if (options.kind === 'human') {
      this.accentRing = scene.add.circle(0, 0, options.width * 0.72, ACCENT_COLOR, 0);
      this.accentRing.setStrokeStyle(2, ACCENT_COLOR, 0.85);
      children.unshift(this.accentRing);
    }

    if (options.kind === 'goalkeeper') {
      this.gloveLeft = scene.add.circle(-options.width * 0.28, options.height * 0.1, 5, 0xfff4d6, 0.95);
      this.gloveRight = scene.add.circle(options.width * 0.28, options.height * 0.1, 5, 0xfff4d6, 0.95);
      children.push(this.gloveLeft, this.gloveRight);
    }

    this.container = scene.add.container(x, y, children);
    this.drawBody(options.teamColor, options.kind);
  }

  private drawBody(teamColor: number, kind: PlayerVisualOptions['kind']): void {
    const w = this.baseWidth;
    const h = this.baseHeight;
    const g = this.bodyShape;
    g.clear();

    const darker = PlayerVisual.darken(teamColor, 50);
    const lighter = PlayerVisual.lighten(teamColor, 30);

    g.fillStyle(darker, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + 2, w, h - 2, 4);

    g.fillStyle(lighter, 1);
    g.fillRoundedRect(-w / 2 + 2, -h / 2, w - 4, h * 0.55, 3);

    const stripeW = w * 0.18;
    g.fillStyle(0xffffff, kind === 'opponent' ? 0.35 : 0.55);
    g.fillRect(-stripeW / 2, -h / 2 + 3, stripeW, h - 6);

    const strokeColor = kind === 'human' ? ACCENT_COLOR : kind === 'opponent' ? 0xffffff : 0xdddddd;
    const strokeAlpha = kind === 'human' ? 1 : kind === 'opponent' ? 0.75 : 0.5;
    g.lineStyle(kind === 'human' ? 2.5 : 1.5, strokeColor, strokeAlpha);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
  }

  private static darken(color: number, amount: number): number {
    const r = Math.max(0, ((color >> 16) & 0xff) - amount);
    const g = Math.max(0, ((color >> 8) & 0xff) - amount);
    const b = Math.max(0, (color & 0xff) - amount);
    return (r << 16) | (g << 8) | b;
  }

  private static lighten(color: number, amount: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + amount);
    const g = Math.min(255, ((color >> 8) & 0xff) + amount);
    const b = Math.min(255, (color & 0xff) + amount);
    return (r << 16) | (g << 8) | b;
  }

  sync(x: number, y: number, depth: number, vx: number, vy: number, airScale = 1): void {
    this.container.setPosition(x, y);
    this.container.setDepth(depth);

    const speed = Math.sqrt(vx * vx + vy * vy);
    const stretch = 1 + Math.min(speed / 400, 0.05);
    const squash = 1 - Math.min(speed / 500, 0.04);
    this.container.setScale(1, stretch * squash);

    if (speed > 12) {
      this.container.setRotation(Math.atan2(vy, vx) + Math.PI / 2);
    }

    const shadowScale = 0.85 + (1 - airScale) * 0.2;
    this.shadow.setScale(shadowScale, shadowScale * 0.9);
    this.shadow.setAlpha(0.18 + airScale * 0.12);
  }

  destroy(): void {
    this.container.destroy();
  }
}

export function createPlayerVisual(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: PlayerVisualOptions,
): PlayerVisual {
  return new PlayerVisual(scene, x, y, options);
}

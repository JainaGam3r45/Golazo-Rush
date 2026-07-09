import Phaser from 'phaser';

export const KICK_RANGE = 36;
export const KICK_FORCE = 380;
export const CHARGED_KICK_FORCE = 620;
export const KICK_OFFSET = 12;
export const KICK_COOLDOWN_MS = 250;
export const BOT_KICK_COOLDOWN_MS = 400;
export const GK_KICK_COOLDOWN_MS = 350;

export type FieldPlayerKind = 'human' | 'teammate' | 'opponent';

export class FieldPlayer extends Phaser.GameObjects.Rectangle {
  declare body: Phaser.Physics.Arcade.Body;

  protected readonly maxSpeed: number;
  protected readonly teamColor: number;
  protected readonly kickCooldownMs: number;
  protected lastKickAt = 0;
  readonly side: 'home' | 'away';
  readonly kind: FieldPlayerKind;
  readonly slot: number;
  readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    options: {
      teamColor: number;
      side: 'home' | 'away';
      kind: FieldPlayerKind;
      slot: number;
      maxSpeed?: number;
      width?: number;
      height?: number;
      strokeColor?: number;
      strokeAlpha?: number;
      fillAlpha?: number;
      kickCooldownMs?: number;
    },
  ) {
    const width = options.width ?? 28;
    const height = options.height ?? 28;
    super(scene, x, y, width, height, options.teamColor, options.fillAlpha ?? 1);
    this.teamColor = options.teamColor;
    this.side = options.side;
    this.kind = options.kind;
    this.slot = options.slot;
    this.maxSpeed = options.maxSpeed ?? 220;
    this.kickCooldownMs = options.kickCooldownMs ?? KICK_COOLDOWN_MS;

    this.shadow = scene.add.ellipse(x, y + height * 0.35, width * 0.9, height * 0.35, 0x000000, 0.25);
    this.shadow.setDepth(0);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(1);

    const strokeColor = options.strokeColor ?? 0xffffff;
    const strokeAlpha = options.strokeAlpha ?? (options.kind === 'human' ? 1 : 0.55);
    this.setStrokeStyle(options.kind === 'human' ? 3 : 2, strokeColor, strokeAlpha);

    if (options.kind === 'teammate') {
      this.setAlpha(0.92);
    }

    this.body.setCollideWorldBounds(true);
    this.body.setImmovable(false);
  }

  updateShadow(): void {
    this.shadow.setPosition(this.x, this.y + this.height * 0.35);
  }

  setMovement(vx: number, vy: number): void {
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > this.maxSpeed) {
      const scale = this.maxSpeed / speed;
      vx *= scale;
      vy *= scale;
    }
    this.body.setVelocity(vx, vy);
    this.updateShadow();
  }

  stop(): void {
    this.body.setVelocity(0, 0);
    this.updateShadow();
  }

  moveToward(targetX: number, targetY: number, speed = this.maxSpeed): void {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 4) {
      this.stop();
      return;
    }
    this.setMovement((dx / distance) * speed, (dy / distance) * speed);
  }

  distanceTo(targetX: number, targetY: number): number {
    return Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);
  }

  get kickRange(): number {
    return KICK_RANGE;
  }

  getKickForce(charged = false): number {
    return charged ? CHARGED_KICK_FORCE : KICK_FORCE;
  }

  canKick(time: number): boolean {
    return time - this.lastKickAt >= this.kickCooldownMs;
  }

  markKicked(time: number): void {
    this.lastKickAt = time;
  }

  kickBall(
    ball: Phaser.GameObjects.GameObject & {
      body: Phaser.Physics.Arcade.Body;
      x: number;
      y: number;
      setPosition(x: number, y: number): void;
    },
    charged = false,
    time = 0,
    forceScale = 1,
  ): boolean {
    if (!this.canKick(time)) return false;
    if (this.distanceTo(ball.x, ball.y) > this.kickRange) return false;

    const dx = ball.x - this.x;
    const dy = ball.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;

    ball.setPosition(
      this.x + nx * (this.width / 2 + KICK_OFFSET),
      this.y + ny * (this.height / 2 + KICK_OFFSET),
    );

    const force = this.getKickForce(charged) * forceScale;
    const multiplier = charged ? 1.15 : 1;
    ball.body.setVelocity(nx * force * multiplier, ny * force * multiplier);

    this.lastKickAt = time;
    return true;
  }

  resetTo(x: number, y: number): void {
    this.setPosition(x, y);
    this.stop();
    this.lastKickAt = 0;
    this.updateShadow();
  }

  get color(): number {
    return this.teamColor;
  }

  get movementSpeed(): number {
    return this.maxSpeed;
  }

  destroy(fromScene?: boolean): void {
    this.shadow.destroy();
    super.destroy(fromScene);
  }
}

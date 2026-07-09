import Phaser from 'phaser';

const TRAIL_MAX_POINTS = 6;
const TRAIL_MIN_SPEED = 120;

export class Ball extends Phaser.GameObjects.Arc {
  declare body: Phaser.Physics.Arcade.Body;

  readonly shadow: Phaser.GameObjects.Ellipse;
  private trailPoints: { x: number; y: number }[] = [];
  private trailGraphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 12, 0, 360, false, 0xffffff);
    this.shadow = scene.add.ellipse(x, y + 10, 20, 8, 0x000000, 0.25);
    this.shadow.setDepth(0);

    this.trailGraphics = scene.add.graphics();
    this.trailGraphics.setDepth(0);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(2);

    this.body.setCircle(12);
    this.body.setBounce(0.82, 0.82);
    this.body.setCollideWorldBounds(true);
    this.body.setDrag(140);
    this.body.setMaxVelocity(600, 600);
  }

  updateTrail(): void {
    this.shadow.setPosition(this.x, this.y + 10);

    const speed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
    if (speed > TRAIL_MIN_SPEED) {
      this.trailPoints.push({ x: this.x, y: this.y });
      if (this.trailPoints.length > TRAIL_MAX_POINTS) {
        this.trailPoints.shift();
      }
    } else if (this.trailPoints.length > 0) {
      this.trailPoints.shift();
    }

    this.trailGraphics.clear();
    if (this.trailPoints.length < 2) return;

    for (let i = 1; i < this.trailPoints.length; i++) {
      const alpha = (i / this.trailPoints.length) * 0.35;
      this.trailGraphics.fillStyle(0xffffff, alpha);
      const pt = this.trailPoints[i];
      const size = 4 + i;
      this.trailGraphics.fillCircle(pt.x, pt.y, size);
    }
  }

  clearTrail(): void {
    this.trailPoints = [];
    this.trailGraphics.clear();
  }

  flashKick(): void {
    this.scene.tweens.add({
      targets: this,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 60,
      yoyo: true,
    });
  }

  resetPosition(x: number, y: number): void {
    this.setPosition(x, y);
    this.setScale(1);
    this.body.setVelocity(0, 0);
    this.clearTrail();
    this.shadow.setPosition(x, y + 10);
  }

  destroy(fromScene?: boolean): void {
    this.shadow.destroy();
    this.trailGraphics.destroy();
    super.destroy(fromScene);
  }
}

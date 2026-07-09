import Phaser from 'phaser';
import { getBallAirTime } from '../ai/possession';

const TRAIL_MAX_POINTS = 6;
const TRAIL_MIN_SPEED = 100;
const BALL_RADIUS = 12;

export class Ball extends Phaser.GameObjects.Container {
  declare body: Phaser.Physics.Arcade.Body;

  readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly ballGraphics: Phaser.GameObjects.Graphics;
  private readonly hitCircle: Phaser.GameObjects.Arc;
  private trailPoints: { x: number; y: number }[] = [];
  private trailGraphics: Phaser.GameObjects.Graphics;
  private patternRotation = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    this.shadow = scene.add.ellipse(0, 10, 20, 8, 0x000000, 0.25);
    this.ballGraphics = scene.add.graphics();
    this.hitCircle = scene.add.circle(0, 0, BALL_RADIUS, 0xffffff, 0.01);

    this.trailGraphics = scene.add.graphics();
    this.add([this.shadow, this.trailGraphics, this.ballGraphics, this.hitCircle]);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(2);

    this.body.setCircle(BALL_RADIUS);
    this.body.setBounce(0.82, 0.82);
    this.body.setCollideWorldBounds(true);
    this.body.setDrag(140);
    this.body.setMaxVelocity(600, 600);

    this.drawBallPattern();
  }

  private drawBallPattern(): void {
    const g = this.ballGraphics;
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, BALL_RADIUS);

    g.fillStyle(0x222222, 1);
    const spots = [
      { x: 0, y: -5, r: 3.5 },
      { x: 5, y: 2, r: 3 },
      { x: -5, y: 2, r: 3 },
      { x: 0, y: 6, r: 2.5 },
    ];
    for (const spot of spots) {
      g.fillCircle(spot.x, spot.y, spot.r);
    }

    g.lineStyle(1, 0xcccccc, 0.6);
    g.strokeCircle(0, 0, BALL_RADIUS - 1);
  }

  updateTrail(time = 0): void {
    const airTime = getBallAirTime();
    const inAir = time > 0 && time < airTime;
    const airLift = inAir ? Math.min((airTime - time) / 700, 1) * 18 : 0;
    const airScale = inAir ? 0.7 + (1 - (airTime - time) / 700) * 0.3 : 1;

    this.shadow.setPosition(0, 10 + airLift * 0.4);
    this.shadow.setScale(airScale, airScale * 0.85);
    this.ballGraphics.setPosition(0, -airLift);
    this.hitCircle.setPosition(0, -airLift);

    const speed = Math.sqrt(this.body.velocity.x ** 2 + this.body.velocity.y ** 2);
    this.patternRotation += speed * 0.002;
    this.ballGraphics.setRotation(this.patternRotation);

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
      const localX = pt.x - this.x;
      const localY = pt.y - this.y;
      const size = 3 + i;
      this.trailGraphics.fillCircle(localX, localY, size);
    }
  }

  clearTrail(): void {
    this.trailPoints = [];
    this.trailGraphics.clear();
  }

  flashKick(): void {
    this.scene.tweens.add({
      targets: this.ballGraphics,
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
    this.shadow.setPosition(0, 10);
    this.ballGraphics.setPosition(0, 0);
    this.hitCircle.setPosition(0, 0);
  }

  destroy(fromScene?: boolean): void {
    this.trailGraphics.destroy();
    super.destroy(fromScene);
  }
}

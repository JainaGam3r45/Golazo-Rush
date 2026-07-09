import Phaser from 'phaser';
import { getBallAirTime } from '../ai/possession';

const TRAIL_MAX_POINTS = 7;
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

    this.shadow = scene.add.ellipse(1, 11, 22, 9, 0x000000, 0.32);
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

    g.fillStyle(0xd8d8d8, 1);
    g.fillCircle(1.5, 1.5, BALL_RADIUS);

    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, BALL_RADIUS);

    g.fillStyle(0xf4f4f4, 0.9);
    g.fillCircle(-3.5, -3.5, 4);

    g.fillStyle(0x1a1a1a, 1);
    const spots = [
      { x: 0, y: -5.5, r: 3.6 },
      { x: 5.2, y: 1.5, r: 3.1 },
      { x: -5.2, y: 1.5, r: 3.1 },
      { x: 0, y: 6.2, r: 2.6 },
      { x: 3.2, y: -3.2, r: 1.8 },
    ];
    for (const spot of spots) {
      g.fillCircle(spot.x, spot.y, spot.r);
    }

    g.lineStyle(1.5, 0xb0b0b0, 0.75);
    g.strokeCircle(0, 0, BALL_RADIUS - 0.5);
    g.lineStyle(1, 0xffffff, 0.35);
    g.strokeCircle(-2, -2, BALL_RADIUS - 3);
  }

  updateTrail(time = 0): void {
    const airTime = getBallAirTime();
    const inAir = time > 0 && time < airTime;
    const airLift = inAir ? Math.min((airTime - time) / 700, 1) * 20 : 0;
    const airScale = inAir ? 0.72 + (1 - (airTime - time) / 700) * 0.28 : 1;

    this.shadow.setPosition(1.5, 11 + airLift * 0.45);
    this.shadow.setScale(airScale * 1.05, airScale * 0.82);
    this.shadow.setAlpha(inAir ? 0.2 : 0.32);
    this.ballGraphics.setPosition(0, -airLift);
    this.ballGraphics.setScale(airScale + (inAir ? 0.04 : 0), airScale);
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
      const alpha = (i / this.trailPoints.length) * 0.4;
      this.trailGraphics.fillStyle(0xffffff, alpha);
      const pt = this.trailPoints[i];
      const localX = pt.x - this.x;
      const localY = pt.y - this.y;
      const size = 2.5 + i * 0.9;
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
      scaleX: 1.25,
      scaleY: 0.85,
      duration: 55,
      yoyo: true,
    });
  }

  resetPosition(x: number, y: number): void {
    this.setPosition(x, y);
    this.setScale(1);
    this.body.setVelocity(0, 0);
    this.clearTrail();
    this.shadow.setPosition(1.5, 11);
    this.ballGraphics.setPosition(0, 0);
    this.ballGraphics.setScale(1);
    this.hitCircle.setPosition(0, 0);
  }

  destroy(fromScene?: boolean): void {
    this.trailGraphics.destroy();
    super.destroy(fromScene);
  }
}

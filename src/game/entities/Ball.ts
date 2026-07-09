import Phaser from 'phaser';

export class Ball extends Phaser.GameObjects.Arc {
  declare body: Phaser.Physics.Arcade.Body;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 12, 0, 360, false, 0xffffff);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setCircle(12);
    this.body.setBounce(0.92, 0.88);
    this.body.setCollideWorldBounds(true);
    this.body.setDrag(100);
    this.body.setMaxVelocity(650, 650);
  }

  kickFrom(playerX: number, playerY: number, force: number, charged = false): void {
    const dx = this.x - playerX;
    const dy = this.y - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const multiplier = charged ? 1.15 : 1;

    this.body.setVelocity(
      (dx / distance) * force * multiplier,
      (dy / distance) * force * multiplier,
    );

    if (charged) {
      this.scene.tweens.add({
        targets: this,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 80,
        yoyo: true,
      });
    }
  }

  resetPosition(x: number, y: number): void {
    this.setPosition(x, y);
    this.setScale(1);
    this.body.setVelocity(0, 0);
  }
}

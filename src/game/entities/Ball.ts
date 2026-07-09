import Phaser from 'phaser';

export class Ball extends Phaser.GameObjects.Arc {
  declare body: Phaser.Physics.Arcade.Body;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 12, 0, 360, false, 0xffffff);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setCircle(12);
    this.body.setBounce(0.85, 0.8);
    this.body.setCollideWorldBounds(true);
    this.body.setDrag(160);
    this.body.setMaxVelocity(650, 650);
  }

  kickFrom(playerX: number, playerY: number, force: number, charged = false): void {
    const dx = this.x - playerX;
    const dy = this.y - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    const multiplier = charged ? 1.15 : 1;

    this.setPosition(playerX + nx * 20, playerY + ny * 20);
    this.body.setVelocity(nx * force * multiplier, ny * force * multiplier);

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

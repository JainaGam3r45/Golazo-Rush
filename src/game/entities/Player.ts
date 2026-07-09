import Phaser from 'phaser';

const PLAYER_SPEED = 220;
const SPRINT_MULTIPLIER = 1.5;
const SPRINT_COOLDOWN_MS = 2000;
const SPRINT_DURATION_MS = 800;
const KICK_RANGE = 36;
const KICK_FORCE = 380;
const CHARGED_KICK_FORCE = 620;
const CHARGE_TIME_MS = 400;

export class Player extends Phaser.GameObjects.Rectangle {
  declare body: Phaser.Physics.Arcade.Body;

  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    SHIFT: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };

  private sprinting = false;
  private sprintCooldownUntil = 0;
  private chargingKick = false;
  private chargeStartedAt = 0;
  private teamColor: number;

  constructor(scene: Phaser.Scene, x: number, y: number, teamColor = 0x39ff14) {
    super(scene, x, y, 28, 28, teamColor);
    this.teamColor = teamColor;
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.body.setCollideWorldBounds(true);
    this.body.setImmovable(false);

    const keyboard = scene.input.keyboard;
    if (keyboard) {
      this.keys = {
        W: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        SHIFT: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        SPACE: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      };
    }
  }

  update(time: number): { kick: boolean; charged: boolean } {
    let vx = 0;
    let vy = 0;

    if (this.keys.A.isDown) vx -= PLAYER_SPEED;
    if (this.keys.D.isDown) vx += PLAYER_SPEED;
    if (this.keys.W.isDown) vy -= PLAYER_SPEED;
    if (this.keys.S.isDown) vy += PLAYER_SPEED;

    const moving = vx !== 0 || vy !== 0;
    const canSprint = time >= this.sprintCooldownUntil;

    if (this.keys.SHIFT.isDown && moving && canSprint && !this.sprinting) {
      this.sprinting = true;
      this.sprintCooldownUntil = time + SPRINT_COOLDOWN_MS;
      this.scene.time.delayedCall(SPRINT_DURATION_MS, () => {
        this.sprinting = false;
      });
    }

    const speedMult = this.sprinting ? SPRINT_MULTIPLIER : 1;
    this.body.setVelocity(vx * speedMult, vy * speedMult);

    let kick = false;
    let charged = false;

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.chargingKick = true;
      this.chargeStartedAt = time;
    }

    if (this.chargingKick && this.keys.SPACE.isUp) {
      const chargeDuration = time - this.chargeStartedAt;
      charged = chargeDuration >= CHARGE_TIME_MS;
      kick = true;
      this.chargingKick = false;
    }

    return { kick, charged };
  }

  distanceTo(targetX: number, targetY: number): number {
    return Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);
  }

  get kickRange(): number {
    return KICK_RANGE;
  }

  getKickForce(charged: boolean): number {
    return charged ? CHARGED_KICK_FORCE : KICK_FORCE;
  }

  get color(): number {
    return this.teamColor;
  }
}

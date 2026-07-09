import Phaser from 'phaser';
import { FieldPlayer } from './FieldPlayer';

const PLAYER_SPEED = 220;
const SPRINT_MULTIPLIER = 1.5;
const SPRINT_COOLDOWN_MS = 2000;
const SPRINT_DURATION_MS = 800;
const CHARGE_TIME_MS = 400;

export class HumanPlayer extends FieldPlayer {
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
  private youLabel: Phaser.GameObjects.Text | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    teamColor: number,
    side: 'home' | 'away',
    slot: number,
  ) {
    super(scene, x, y, {
      teamColor,
      side,
      kind: 'human',
      slot,
      maxSpeed: PLAYER_SPEED,
    });

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

    this.youLabel = scene.add
      .text(x, y - 22, 'Tú', {
        fontFamily: 'Bebas Neue, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#0a0f0a',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
  }

  override resetTo(x: number, y: number): void {
    super.resetTo(x, y);
    if (this.youLabel) {
      this.youLabel.setPosition(x, y - 22);
    }
  }

  update(time: number): { kick: boolean; charged: boolean } {
    let vx = 0;
    let vy = 0;

    if (this.keys?.A.isDown) vx -= PLAYER_SPEED;
    if (this.keys?.D.isDown) vx += PLAYER_SPEED;
    if (this.keys?.W.isDown) vy -= PLAYER_SPEED;
    if (this.keys?.S.isDown) vy += PLAYER_SPEED;

    const moving = vx !== 0 || vy !== 0;
    const canSprint = time >= this.sprintCooldownUntil;

    if (this.keys?.SHIFT.isDown && moving && canSprint && !this.sprinting) {
      this.sprinting = true;
      this.sprintCooldownUntil = time + SPRINT_COOLDOWN_MS;
      this.scene.time.delayedCall(SPRINT_DURATION_MS, () => {
        this.sprinting = false;
      });
    }

    const speedMult = this.sprinting ? SPRINT_MULTIPLIER : 1;
    this.setMovement(vx * speedMult, vy * speedMult);

    if (this.youLabel) {
      this.youLabel.setPosition(this.x, this.y - 22);
    }

    let kick = false;
    let charged = false;

    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.chargingKick = true;
      this.chargeStartedAt = time;
    }

    if (this.chargingKick && this.keys?.SPACE.isUp) {
      const chargeDuration = time - this.chargeStartedAt;
      charged = chargeDuration >= CHARGE_TIME_MS;
      kick = true;
      this.chargingKick = false;
    }

    return { kick, charged };
  }

  destroy(fromScene?: boolean): void {
    this.youLabel?.destroy();
    this.youLabel = null;
    super.destroy(fromScene);
  }
}

import Phaser from 'phaser';
import { areGameplayKeysSuspended } from '../../lib/match/inputSuspend';
import { FieldPlayer } from './FieldPlayer';

const PLAYER_SPEED = 220;
const SPRINT_MULTIPLIER = 1.5;
const SPRINT_COOLDOWN_MS = 2000;
const SPRINT_DURATION_MS = 800;
const CHARGE_TIME_MS = 400;
const ACCENT_COLOR = 0x3ddc84;
const PASS_COOLDOWN_MS = 450;
const LONG_KICK_COOLDOWN_MS = 700;

export type HumanAction =
  | { type: 'kick'; charged: boolean }
  | { type: 'pass'; mode: 'short' | 'long' }
  | { type: 'tackle' };

export class HumanPlayer extends FieldPlayer {
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    SHIFT: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
    Q: Phaser.Input.Keyboard.Key;
    F: Phaser.Input.Keyboard.Key;
  };

  private sprinting = false;
  private sprintCooldownUntil = 0;
  private chargingKick = false;
  private chargeStartedAt = 0;
  private youLabel: Phaser.GameObjects.Text | null = null;
  private chargeRing: Phaser.GameObjects.Arc;
  private sprintLines: Phaser.GameObjects.Graphics;
  private lastMoveDir = { x: 0, y: -1 };
  private lastPassAt = 0;
  private lastLongKickAt = 0;
  private lastTackleAt = 0;
  private sprintTimer: Phaser.Time.TimerEvent | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    teamColor: number,
    side: 'home' | 'away',
    slot: number,
    scale = 1,
  ) {
    super(scene, x, y, {
      teamColor,
      side,
      kind: 'human',
      slot,
      maxSpeed: PLAYER_SPEED,
      scale,
      strokeColor: ACCENT_COLOR,
    });

    this.chargeRing = scene.add.circle(x, y, 18, ACCENT_COLOR, 0);
    this.chargeRing.setStrokeStyle(2, ACCENT_COLOR, 0);
    this.chargeRing.setDepth(3);

    this.sprintLines = scene.add.graphics();
    this.sprintLines.setDepth(0);

    const keyboard = scene.input.keyboard;
    if (keyboard) {
      this.keys = {
        W: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        SHIFT: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        SPACE: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        E: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
        Q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
        F: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
      };
    }

    this.youLabel = scene.add
      .text(x, y - 30, 'Tú', {
        fontFamily: 'Bebas Neue, sans-serif',
        fontSize: '22px',
        color: '#3ddc84',
        stroke: '#0a0f0a',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(4);
  }

  getLastTackleAt(): number {
    return this.lastTackleAt;
  }

  markTackle(time: number): void {
    this.lastTackleAt = time;
  }

  getKickDirection(): { x: number; y: number } {
    const moving = this.lastMoveDir.x !== 0 || this.lastMoveDir.y !== 0;
    if (moving) return { ...this.lastMoveDir };

    const goalX = this.side === 'home' ? 1100 : 0;
    const dx = goalX - this.x;
    const dy = 325 - this.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  override resetTo(x: number, y: number): void {
    super.resetTo(x, y);
    this.updateDecorations(0, false, 0);
    this.lastPassAt = 0;
    this.lastLongKickAt = 0;
    this.lastTackleAt = 0;
  }

  private updateDecorations(time: number, charging: boolean, chargeProgress: number): void {
    this.chargeRing.setPosition(this.x, this.y);

    if (charging && chargeProgress > 0) {
      const scale = 1 + chargeProgress * 0.5;
      this.chargeRing.setScale(scale);
      this.chargeRing.setStrokeStyle(2, ACCENT_COLOR, 0.4 + chargeProgress * 0.5);
    } else {
      this.chargeRing.setScale(1);
      this.chargeRing.setStrokeStyle(2, ACCENT_COLOR, 0);
    }

    if (this.youLabel) {
      this.youLabel.setPosition(this.x, this.y - 30);
    }

    this.sprintLines.clear();
    if (this.sprinting) {
      const backX = this.x - this.lastMoveDir.x * 16;
      const backY = this.y - this.lastMoveDir.y * 16;
      const perpX = -this.lastMoveDir.y;
      const perpY = this.lastMoveDir.x;

      this.sprintLines.lineStyle(2, ACCENT_COLOR, 0.5);
      this.sprintLines.beginPath();
      this.sprintLines.moveTo(backX + perpX * 4, backY + perpY * 4);
      this.sprintLines.lineTo(backX - this.lastMoveDir.x * 10, backY - this.lastMoveDir.y * 10);
      this.sprintLines.strokePath();

      this.sprintLines.beginPath();
      this.sprintLines.moveTo(backX - perpX * 4, backY - perpY * 4);
      this.sprintLines.lineTo(backX - this.lastMoveDir.x * 10, backY - this.lastMoveDir.y * 10);
      this.sprintLines.strokePath();
    }
  }

  update(time: number): HumanAction | null {
    if (areGameplayKeysSuspended(this.scene.game)) {
      this.setMovement(0, 0);
      this.chargingKick = false;
      this.updateDecorations(time, false, 0);
      return null;
    }

    let vx = 0;
    let vy = 0;

    if (this.keys?.A.isDown) vx -= PLAYER_SPEED;
    if (this.keys?.D.isDown) vx += PLAYER_SPEED;
    if (this.keys?.W.isDown) vy -= PLAYER_SPEED;
    if (this.keys?.S.isDown) vy += PLAYER_SPEED;

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      this.lastMoveDir = { x: vx / len, y: vy / len };
    }

    const canSprint = time >= this.sprintCooldownUntil;

    if (this.keys?.SHIFT.isDown && moving && canSprint && !this.sprinting) {
      this.sprinting = true;
      this.sprintCooldownUntil = time + SPRINT_COOLDOWN_MS;
      this.sprintTimer?.remove();
      this.sprintTimer = this.scene.time.delayedCall(SPRINT_DURATION_MS, () => {
        this.sprinting = false;
        this.sprintTimer = null;
      });
    }

    const speedMult = this.sprinting ? SPRINT_MULTIPLIER : 1;
    this.setMovement(vx * speedMult, vy * speedMult);

    let chargeProgress = 0;

    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.chargingKick = true;
      this.chargeStartedAt = time;
    }

    if (this.chargingKick && this.keys?.SPACE.isDown) {
      chargeProgress = Math.min(1, (time - this.chargeStartedAt) / CHARGE_TIME_MS);
    }

    if (this.chargingKick && this.keys?.SPACE.isUp) {
      const chargeDuration = time - this.chargeStartedAt;
      const charged = chargeDuration >= CHARGE_TIME_MS;
      this.chargingKick = false;
      this.updateDecorations(time, false, 0);
      return { type: 'kick', charged };
    }

    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.E) && time - this.lastPassAt >= PASS_COOLDOWN_MS) {
      this.lastPassAt = time;
      this.updateDecorations(time, this.chargingKick, chargeProgress);
      return { type: 'pass', mode: 'short' };
    }

    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.Q) && time - this.lastLongKickAt >= LONG_KICK_COOLDOWN_MS) {
      this.lastLongKickAt = time;
      this.updateDecorations(time, this.chargingKick, chargeProgress);
      return { type: 'pass', mode: 'long' };
    }

    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
      this.updateDecorations(time, this.chargingKick, chargeProgress);
      return { type: 'tackle' };
    }

    this.updateDecorations(time, this.chargingKick, chargeProgress);
    return null;
  }

  override updateShadow(): void {
    super.updateShadow();
    if (this.youLabel) {
      this.youLabel.setDepth(this.y + 1);
    }
    this.chargeRing.setDepth(this.y + 2);
  }

  destroy(fromScene?: boolean): void {
    this.sprintTimer?.remove();
    this.sprintTimer = null;
    this.youLabel?.destroy();
    this.youLabel = null;
    this.chargeRing.destroy();
    this.sprintLines.destroy();
    super.destroy(fromScene);
  }
}

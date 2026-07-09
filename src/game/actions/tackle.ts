import Phaser from 'phaser';
import type { Ball } from '../entities/Ball';
import type { FieldPlayer } from '../entities/FieldPlayer';
import {
  getBallController,
  getBallState,
  isBallIdle,
  transferBallControl,
} from '../ai/possession';

const TACKLE_RANGE = 42;
const TACKLE_COOLDOWN_MS = 900;
const FOUL_SPEED_THRESHOLD = 200;
const FOUL_ANGLE_DEG = 110;
const CLEAN_ANGLE_DEG = 70;

export type TackleResult =
  | { type: 'miss' }
  | { type: 'success'; victim: FieldPlayer }
  | { type: 'foul'; victim: FieldPlayer; fouledSide: 'home' | 'away' };

export function getTackleCooldownMs(): number {
  return TACKLE_COOLDOWN_MS;
}

function getFacing(player: FieldPlayer): { x: number; y: number } {
  const vx = player.body.velocity.x;
  const vy = player.body.velocity.y;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > 10) return { x: vx / speed, y: vy / speed };
  return { x: player.side === 'home' ? 1 : -1, y: 0 };
}

function angleBetween(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dot = ax * bx + ay * by;
  const mag = Math.sqrt(ax * ax + ay * ay) * Math.sqrt(bx * bx + by * by) || 1;
  return Math.acos(Phaser.Math.Clamp(dot / mag, -1, 1));
}

export function tryTackle(
  tackler: FieldPlayer,
  ball: Ball,
  opponents: FieldPlayer[],
  time: number,
  lastTackleAt: number,
): TackleResult {
  if (time - lastTackleAt < TACKLE_COOLDOWN_MS) {
    return { type: 'miss' };
  }

  const controller = getBallController();
  const state = getBallState();

  let victim: FieldPlayer | null = null;
  if (controller && controller.side !== tackler.side) {
    victim = controller;
  } else if (state === 'free' || state === 'contested') {
    for (const opp of opponents) {
      if (tackler.distanceTo(opp.x, opp.y) <= TACKLE_RANGE && isBallIdle(ball)) {
        if (tackler.distanceTo(ball.x, ball.y) <= TACKLE_RANGE) {
          victim = opp;
          break;
        }
      }
    }
  }

  if (!victim || tackler.distanceTo(victim.x, victim.y) > TACKLE_RANGE) {
    return { type: 'miss' };
  }

  const tacklerFacing = getFacing(tackler);
  const toVictimX = victim.x - tackler.x;
  const toVictimY = victim.y - tackler.y;
  const toVictimLen = Math.sqrt(toVictimX * toVictimX + toVictimY * toVictimY) || 1;
  const toVictimNx = toVictimX / toVictimLen;
  const toVictimNy = toVictimY / toVictimLen;

  const victimFacing = getFacing(victim);
  const approachAngle = angleBetween(tacklerFacing.x, tacklerFacing.y, toVictimNx, toVictimNy);
  const fromBehindAngle = angleBetween(-victimFacing.x, -victimFacing.y, toVictimNx, toVictimNy);

  const tacklerSpeed = Math.sqrt(
    tackler.body.velocity.x ** 2 + tackler.body.velocity.y ** 2,
  );

  const isFromBehind = fromBehindAngle > Phaser.Math.DegToRad(FOUL_ANGLE_DEG);
  const isTooFast = tacklerSpeed > FOUL_SPEED_THRESHOLD;
  const isClean =
    approachAngle <= Phaser.Math.DegToRad(CLEAN_ANGLE_DEG) && !isFromBehind && !isTooFast;

  if (!isClean) {
    return { type: 'foul', victim, fouledSide: victim.side };
  }

  ball.body.setVelocity(0, 0);
  transferBallControl(tackler, time);
  return { type: 'success', victim };
}

import Phaser from 'phaser';
import type { Ball } from '../entities/Ball';
import type { FieldPlayer } from '../entities/FieldPlayer';
import { KICK_FORCE, CHARGED_KICK_FORCE } from '../entities/FieldPlayer';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { markBallKicked } from '../ai/possession';

const SHORT_PASS_MIN = 40;
const SHORT_PASS_MAX = 220;
const LONG_PASS_MIN = 120;
const LONG_PASS_MAX = 420;

const SHORT_ERROR_DEG = 6;
const LONG_ERROR_DEG = 14;

export type PassMode = 'short' | 'long';

function getOpponentGoalX(side: 'home' | 'away'): number {
  return side === 'home' ? PITCH_WIDTH : 0;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function isLaneClear(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opponents: FieldPlayer[],
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;

  for (const opp of opponents) {
    const ox = opp.x - fromX;
    const oy = opp.y - fromY;
    const proj = ox * nx + oy * ny;
    if (proj < 0 || proj > dist) continue;
    const perp = Math.abs(ox * ny - oy * nx);
    if (perp < 22) return false;
  }
  return true;
}

export function findPassTarget(
  teammates: FieldPlayer[],
  passer: FieldPlayer,
  opponents: FieldPlayer[],
  mode: PassMode,
): FieldPlayer | null {
  const goalX = getOpponentGoalX(passer.side);
  const goalY = PITCH_HEIGHT / 2;
  const minDist = mode === 'short' ? SHORT_PASS_MIN : LONG_PASS_MIN;
  const maxDist = mode === 'short' ? SHORT_PASS_MAX : LONG_PASS_MAX;

  let best: FieldPlayer | null = null;
  let bestScore = -Infinity;

  for (const mate of teammates) {
    if (mate === passer) continue;
    const dist = passer.distanceTo(mate.x, mate.y);
    if (dist < minDist || dist > maxDist) continue;

    const toGoal = Math.atan2(goalY - mate.y, goalX - mate.x);
    const toMate = Math.atan2(mate.y - passer.y, mate.x - passer.x);
    const forwardBonus = Math.max(0, 1 - angleDiff(toGoal, toMate) / Math.PI) * 40;
    const distScore = mode === 'short' ? 80 - Math.abs(dist - 100) * 0.3 : 60 - Math.abs(dist - 260) * 0.15;
    const laneBonus = isLaneClear(passer.x, passer.y, mate.x, mate.y, opponents) ? 25 : -30;
    const edgeDist = Math.min(mate.y, PITCH_HEIGHT - mate.y);
    const sidelinePenalty = edgeDist < 90 ? (90 - edgeDist) * 0.4 : 0;

    const score = distScore + forwardBonus + laneBonus - sidelinePenalty;
    if (score > bestScore) {
      bestScore = score;
      best = mate;
    }
  }

  return bestScore > 0 ? best : null;
}

export function executePass(
  passer: FieldPlayer,
  ball: Ball,
  target: FieldPlayer | { x: number; y: number },
  mode: PassMode,
  time: number,
): boolean {
  if (!passer.canKick(time)) return false;
  if (passer.distanceTo(ball.x, ball.y) > passer.kickRange + 4) return false;

  const tx = target.x;
  const ty = target.y;

  let dx = tx - passer.x;
  let dy = ty - passer.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= dist;
  dy /= dist;

  const errorRad = Phaser.Math.DegToRad(
    (Math.random() - 0.5) * 2 * (mode === 'short' ? SHORT_ERROR_DEG : LONG_ERROR_DEG),
  );
  const cos = Math.cos(errorRad);
  const sin = Math.sin(errorRad);
  const ndx = dx * cos - dy * sin;
  const ndy = dx * sin + dy * cos;

  const baseForce = mode === 'short' ? KICK_FORCE * 0.72 : CHARGED_KICK_FORCE * 0.95;
  const distScale = Phaser.Math.Clamp(dist / (mode === 'short' ? 140 : 300), 0.7, 1.15);

  ball.setPosition(
    passer.x + ndx * (passer.width / 2 + 14),
    passer.y + ndy * (passer.height / 2 + 14),
  );
  ball.body.setVelocity(ndx * baseForce * distScale, ndy * baseForce * distScale);

  passer.markKicked(time);
  markBallKicked(time, mode === 'long');
  return true;
}

import {
  GOAL_CENTER_Y,
  GOALKEEPER_AWAY_X,
  GOALKEEPER_HOME_X,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
} from '../config/pitch';
import { getLastTouchSide, type TouchSide } from '../ai/possession';
import {
  PLAYABLE_BOTTOM,
  PLAYABLE_LEFT,
  PLAYABLE_RIGHT,
  PLAYABLE_TOP,
  type BallOutResult,
} from './playableBounds';

export type SetPieceType = 'throwIn' | 'corner' | 'goalKick';

export type SetPieceResolution = {
  type: SetPieceType;
  overlay: 'SAQUE LATERAL' | 'CÓRNER' | 'SAQUE DE ARCO';
  ballX: number;
  ballY: number;
  possessionSide: 'home' | 'away';
  impulseX: number;
  impulseY: number;
};

function resolveLastTouch(fallback: 'home' | 'away'): 'home' | 'away' {
  const touch: TouchSide = getLastTouchSide();
  if (touch === 'home' || touch === 'away') return touch;
  return fallback;
}

function clampThrowX(x: number): number {
  return Math.min(PLAYABLE_RIGHT - 12, Math.max(PLAYABLE_LEFT + 12, x));
}

export function resolveSetPiece(out: Extract<BallOutResult, { out: true }>): SetPieceResolution {
  if (out.kind === 'sideline') {
    const lastTouch = resolveLastTouch('away');
    const possessionSide: 'home' | 'away' = lastTouch === 'home' ? 'away' : 'home';
    const ballY = out.side === 'top' ? PLAYABLE_TOP + 10 : PLAYABLE_BOTTOM - 10;
    const ballX = clampThrowX(out.x);
    const towardCenter = out.side === 'top' ? 1 : -1;
    return {
      type: 'throwIn',
      overlay: 'SAQUE LATERAL',
      ballX,
      ballY,
      possessionSide,
      impulseX: 0,
      impulseY: towardCenter * 40,
    };
  }

  const end = out.end;
  // Safer fallback: assume attacker put it out → goal kick for the defending end.
  const lastTouch = resolveLastTouch(end === 'home' ? 'away' : 'home');

  // Defender of this end last touched → corner for the attacker.
  const isCorner = lastTouch === end;

  if (isCorner) {
    const possessionSide: 'home' | 'away' = end === 'home' ? 'away' : 'home';
    const nearTop = out.y < PITCH_HEIGHT / 2;
    const ballX = end === 'home' ? PLAYABLE_LEFT + 8 : PLAYABLE_RIGHT - 8;
    const ballY = nearTop ? PLAYABLE_TOP + 8 : PLAYABLE_BOTTOM - 8;
    const boxX = end === 'home' ? PITCH_MARGIN + 70 : PITCH_WIDTH - PITCH_MARGIN - 70;
    const boxY = GOAL_CENTER_Y;
    const dx = boxX - ballX;
    const dy = boxY - ballY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      type: 'corner',
      overlay: 'CÓRNER',
      ballX,
      ballY,
      possessionSide,
      impulseX: (dx / len) * 55,
      impulseY: (dy / len) * 55,
    };
  }

  const possessionSide: 'home' | 'away' = end;
  const ballX = end === 'home' ? GOALKEEPER_HOME_X + 24 : GOALKEEPER_AWAY_X - 24;
  const ballY = GOAL_CENTER_Y;
  const forward = end === 'home' ? 1 : -1;
  return {
    type: 'goalKick',
    overlay: 'SAQUE DE ARCO',
    ballX,
    ballY,
    possessionSide,
    impulseX: forward * 80,
    impulseY: 0,
  };
}

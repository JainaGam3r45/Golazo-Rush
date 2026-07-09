import {
  GOAL_CENTER_Y,
  GOALKEEPER_AWAY_X,
  GOALKEEPER_HOME_X,
  GOALKEEPER_Y_MAX,
  GOALKEEPER_Y_MIN,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_TOP,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_WIDTH,
} from '../config/pitch';
import { getLastTouchSide, type TouchSide } from '../ai/possession';
import {
  clampToPlayable,
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
  /** End being attacked on corners / defended on goal kicks. */
  focusEnd: 'home' | 'away';
};

export type SetPieceSlot = {
  x: number;
  y: number;
};

export const SET_PIECE_PREP_MS: Record<SetPieceType, number> = {
  corner: 1800,
  throwIn: 1300,
  goalKick: 1500,
};

/** Extra prep time for denser 11v11 set pieces. */
export const SET_PIECE_PREP_MS_11V11: Record<SetPieceType, number> = {
  corner: 2200,
  throwIn: 1500,
  goalKick: 1800,
};

export function getSetPiecePrepMs(type: SetPieceType, formatId: '5v5' | '11v11' = '5v5'): number {
  return formatId === '11v11' ? SET_PIECE_PREP_MS_11V11[type] : SET_PIECE_PREP_MS[type];
}

/** Time after prep before CPU / auto-take fires. */
export const SET_PIECE_READY_AUTO_MS: Record<SetPieceType, number> = {
  corner: 900,
  throwIn: 700,
  goalKick: 800,
};

/** Hard cap from set-piece start → forced auto-take. */
export const SET_PIECE_MAX_WAIT_MS = 5200;

export const SET_PIECE_RIVAL_MIN_DIST: Record<SetPieceType, number> = {
  corner: 88,
  throwIn: 72,
  goalKick: 100,
};

export const OUT_DETECT_AFTER_SET_PIECE_MS = 1000;

export const SET_PIECE_SETTLE_SPEED = 210;

function resolveLastTouch(fallback: 'home' | 'away'): 'home' | 'away' {
  const touch: TouchSide = getLastTouchSide();
  if (touch === 'home' || touch === 'away') return touch;
  return fallback;
}

function clampThrowX(x: number): number {
  return Math.min(PLAYABLE_RIGHT - 12, Math.max(PLAYABLE_LEFT + 12, x));
}

export function softCorrectSetPieceBall(x: number, y: number): { x: number; y: number } {
  return clampToPlayable(x, y, 6);
}

export function resolveSetPiece(out: Extract<BallOutResult, { out: true }>): SetPieceResolution {
  if (out.kind === 'sideline') {
    const lastTouch = resolveLastTouch('away');
    const possessionSide: 'home' | 'away' = lastTouch === 'home' ? 'away' : 'home';
    const ballY = out.side === 'top' ? PLAYABLE_TOP + 10 : PLAYABLE_BOTTOM - 10;
    const rawX = clampThrowX(out.x);
    const placed = softCorrectSetPieceBall(rawX, ballY);
    const towardCenter = out.side === 'top' ? 1 : -1;
    return {
      type: 'throwIn',
      overlay: 'SAQUE LATERAL',
      ballX: placed.x,
      ballY: placed.y,
      possessionSide,
      impulseX: 0,
      impulseY: towardCenter * 40,
      focusEnd: possessionSide,
    };
  }

  const end = out.end;
  const lastTouch = resolveLastTouch(end === 'home' ? 'away' : 'home');
  const isCorner = lastTouch === end;

  if (isCorner) {
    const possessionSide: 'home' | 'away' = end === 'home' ? 'away' : 'home';
    const nearTop = out.y < PITCH_HEIGHT / 2;
    const rawX = end === 'home' ? PLAYABLE_LEFT + 8 : PLAYABLE_RIGHT - 8;
    const rawY = nearTop ? PLAYABLE_TOP + 8 : PLAYABLE_BOTTOM - 8;
    const placed = softCorrectSetPieceBall(rawX, rawY);
    const boxX = end === 'home' ? PITCH_MARGIN + 70 : PITCH_WIDTH - PITCH_MARGIN - 70;
    const boxY = GOAL_CENTER_Y;
    const dx = boxX - placed.x;
    const dy = boxY - placed.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      type: 'corner',
      overlay: 'CÓRNER',
      ballX: placed.x,
      ballY: placed.y,
      possessionSide,
      impulseX: (dx / len) * 55,
      impulseY: (dy / len) * 55,
      focusEnd: end,
    };
  }

  const possessionSide: 'home' | 'away' = end;
  const rawX = end === 'home' ? GOALKEEPER_HOME_X + 24 : GOALKEEPER_AWAY_X - 24;
  const placed = softCorrectSetPieceBall(rawX, GOAL_CENTER_Y);
  const forward = end === 'home' ? 1 : -1;
  return {
    type: 'goalKick',
    overlay: 'SAQUE DE ARCO',
    ballX: placed.x,
    ballY: placed.y,
    possessionSide,
    impulseX: forward * 80,
    impulseY: 0,
    focusEnd: end,
  };
}

export function getTakerStandOffset(
  type: SetPieceType,
  side: 'home' | 'away',
  ballX: number,
  ballY: number,
  impulseX: number,
  impulseY: number,
): SetPieceSlot {
  if (type === 'corner') {
    const len = Math.sqrt(impulseX * impulseX + impulseY * impulseY) || 1;
    return softCorrectSetPieceBall(
      ballX - (impulseX / len) * 22,
      ballY - (impulseY / len) * 22,
    );
  }
  if (type === 'throwIn') {
    const towardCenter = ballY < PITCH_HEIGHT / 2 ? 1 : -1;
    return softCorrectSetPieceBall(ballX, ballY + towardCenter * 18);
  }
  const back = side === 'home' ? -1 : 1;
  return softCorrectSetPieceBall(ballX + back * 20, ballY);
}

function boxInnerX(end: 'home' | 'away', depth: number): number {
  if (end === 'home') return PITCH_MARGIN + depth;
  return PITCH_WIDTH - PITCH_MARGIN - depth;
}

/** Attack / defend slots inside the relevant penalty box for corners. */
export function getCornerBoxSlots(
  attackedEnd: 'home' | 'away',
  density: '5v5' | '11v11' = '5v5',
): {
  attack: SetPieceSlot[];
  defend: SetPieceSlot[];
  gk: SetPieceSlot;
} {
  const nearPost = boxInnerX(attackedEnd, 42);
  const farPost = boxInnerX(attackedEnd, 98);
  const edge = boxInnerX(attackedEnd, PENALTY_BOX_WIDTH - 18);
  const top = PENALTY_BOX_TOP + 48;
  const mid = GOAL_CENTER_Y;
  const bot = PENALTY_BOX_TOP + PENALTY_BOX_HEIGHT - 48;
  const sideBias = attackedEnd === 'home' ? 36 : -36;

  const attack: SetPieceSlot[] = [
    { x: farPost, y: top + 20 },
    { x: nearPost, y: mid },
    { x: farPost, y: bot - 20 },
    { x: edge, y: mid + sideBias },
  ];
  const defend: SetPieceSlot[] = [
    { x: nearPost, y: top + 10 },
    { x: nearPost, y: bot - 10 },
    { x: farPost, y: mid - 28 },
    { x: farPost, y: mid + 28 },
  ];

  if (density === '11v11') {
    const deep = boxInnerX(attackedEnd, 70);
    const cutback = boxInnerX(attackedEnd, PENALTY_BOX_WIDTH + 8);
    attack.push(
      { x: deep, y: mid - 42 },
      { x: deep, y: mid + 42 },
      { x: cutback, y: mid },
      { x: edge, y: top + 8 },
      { x: edge, y: bot - 8 },
    );
    defend.push(
      { x: nearPost, y: mid },
      { x: deep, y: top + 16 },
      { x: deep, y: bot - 16 },
      { x: farPost, y: mid },
      { x: edge - (attackedEnd === 'home' ? 18 : -18), y: mid },
    );
  }

  return {
    attack,
    defend,
    gk: {
      x: attackedEnd === 'home' ? GOALKEEPER_HOME_X : GOALKEEPER_AWAY_X,
      y: Math.min(GOALKEEPER_Y_MAX, Math.max(GOALKEEPER_Y_MIN, mid)),
    },
  };
}

export function getThrowInSupportSlots(
  ballX: number,
  ballY: number,
  possessionSide: 'home' | 'away',
  density: '5v5' | '11v11' = '5v5',
): SetPieceSlot[] {
  const inward = ballY < PITCH_HEIGHT / 2 ? 1 : -1;
  const forward = possessionSide === 'home' ? 1 : -1;
  const slots = [
    softCorrectSetPieceBall(ballX + forward * 55, ballY + inward * 70),
    softCorrectSetPieceBall(ballX + forward * 110, ballY + inward * 40),
    softCorrectSetPieceBall(ballX - forward * 40, ballY + inward * 85),
    softCorrectSetPieceBall(ballX + forward * 160, ballY + inward * 20),
  ];
  if (density === '11v11') {
    slots.push(
      softCorrectSetPieceBall(ballX + forward * 90, ballY + inward * 110),
      softCorrectSetPieceBall(ballX + forward * 200, ballY + inward * 10),
      softCorrectSetPieceBall(ballX - forward * 80, ballY + inward * 50),
    );
  }
  return slots;
}

export function getGoalKickSupportSlots(
  defendingEnd: 'home' | 'away',
  density: '5v5' | '11v11' = '5v5',
): SetPieceSlot[] {
  const forward = defendingEnd === 'home' ? 1 : -1;
  const baseX = defendingEnd === 'home' ? PITCH_MARGIN + 160 : PITCH_WIDTH - PITCH_MARGIN - 160;
  const slots = [
    softCorrectSetPieceBall(baseX, GOAL_CENTER_Y - 90),
    softCorrectSetPieceBall(baseX + forward * 40, GOAL_CENTER_Y + 90),
    softCorrectSetPieceBall(baseX + forward * 120, GOAL_CENTER_Y - 40),
    softCorrectSetPieceBall(baseX + forward * 120, GOAL_CENTER_Y + 40),
  ];
  if (density === '11v11') {
    slots.push(
      softCorrectSetPieceBall(baseX + forward * 60, GOAL_CENTER_Y),
      softCorrectSetPieceBall(baseX + forward * 180, GOAL_CENTER_Y - 100),
      softCorrectSetPieceBall(baseX + forward * 180, GOAL_CENTER_Y + 100),
      softCorrectSetPieceBall(baseX - forward * 20, GOAL_CENTER_Y - 50),
      softCorrectSetPieceBall(baseX - forward * 20, GOAL_CENTER_Y + 50),
    );
  }
  return slots;
}

export function getGoalKickRivalHoldLine(defendingEnd: 'home' | 'away'): number {
  return defendingEnd === 'home'
    ? PITCH_MARGIN + PENALTY_BOX_WIDTH + 36
    : PITCH_WIDTH - PITCH_MARGIN - PENALTY_BOX_WIDTH - 36;
}

export function cornerCrossTarget(attackedEnd: 'home' | 'away', nearTop: boolean): SetPieceSlot {
  const x = boxInnerX(attackedEnd, 78);
  const y = nearTop ? GOAL_CENTER_Y - 36 : GOAL_CENTER_Y + 36;
  return softCorrectSetPieceBall(x, y);
}

export function setPieceHintText(type: SetPieceType, stage: 'prep' | 'ready'): string {
  if (stage === 'prep') return 'Preparando saque…';
  if (type === 'corner') return 'Pulsa E para pase corto · Q / Espacio para centro';
  if (type === 'goalKick') return 'Pulsa E para pase corto · Q para despeje';
  return 'Pulsa E para pase corto · Q para pase largo';
}

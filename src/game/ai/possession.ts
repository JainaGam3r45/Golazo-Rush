export type TouchSide = 'home' | 'away' | null;

const BALL_IDLE_SPEED = 45;

let lastTouchSide: TouchSide = null;
let lastTouchAt = 0;

export function registerTouch(side: 'home' | 'away', time: number): void {
  lastTouchSide = side;
  lastTouchAt = time;
}

export function getLastTouchSide(): TouchSide {
  return lastTouchSide;
}

export function getLastTouchAt(): number {
  return lastTouchAt;
}

export function resetPossession(): void {
  lastTouchSide = null;
  lastTouchAt = 0;
}

export function isBallIdle(ball: {
  body: { velocity: { x: number; y: number } };
}): boolean {
  const speed = Math.sqrt(ball.body.velocity.x ** 2 + ball.body.velocity.y ** 2);
  return speed < BALL_IDLE_SPEED;
}

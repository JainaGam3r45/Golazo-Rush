import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBall } from '../src/ball.ts';
import { createPlayer } from '../src/player.ts';
import { createPossessionState, transferControl } from '../src/possession.ts';
import { TACKLE_RANGE, PITCH_HEIGHT, PITCH_WIDTH } from '../src/constants.ts';
import {
  pickCarryTarget,
  projectedInterceptPoint,
  updateBots,
} from '../src/bots.ts';
import type { SpawnAnchor } from '../src/constants.ts';

function anchor(x: number, y: number, slot = 0): SpawnAnchor {
  return { x, y, nx: x / PITCH_WIDTH, ny: y / PITCH_HEIGHT, role: 'mid', slot };
}

describe('projectedInterceptPoint', () => {
  it('chases ahead of a moving free ball, not only its current position', () => {
    const chaser = createPlayer({
      id: 'b1',
      side: 'home',
      slot: 0,
      role: 'mid',
      kind: 'bot',
      x: 200,
      y: 300,
    });
    const ball = createBall(400, 300);
    ball.vx = 220;
    ball.vy = 40;
    const possession = createPossessionState();
    const point = projectedInterceptPoint(ball, chaser, possession, [chaser]);

    assert.ok(point.x > ball.x, 'intercept X should lead the ball');
    assert.ok(point.y > ball.y, 'intercept Y should lead the ball');
  });

  it('tracks the opposing controller when the ball is held', () => {
    const presser = createPlayer({
      id: 'press',
      side: 'home',
      slot: 1,
      role: 'mid',
      kind: 'bot',
      x: 300,
      y: 300,
    });
    const holder = createPlayer({
      id: 'hold',
      side: 'away',
      slot: 0,
      role: 'mid',
      kind: 'human',
      x: 520,
      y: 410,
    });
    const ball = createBall(520, 410);
    const possession = createPossessionState();
    transferControl(possession, holder, 1000);
    const point = projectedInterceptPoint(ball, presser, possession, [presser, holder]);

    assert.ok(Math.abs(point.x - holder.x) < 20);
    assert.ok(Math.abs(point.y - holder.y) < 20);
  });
});

describe('pickCarryTarget', () => {
  it('biases carry Y away from a packed center lane toward open space', () => {
    const carrier = createPlayer({
      id: 'c1',
      side: 'home',
      slot: 2,
      role: 'fwd',
      kind: 'bot',
      x: 600,
      y: PITCH_HEIGHT / 2,
    });
    const blockers = [
      createPlayer({
        id: 'o1',
        side: 'away',
        slot: 0,
        role: 'def',
        kind: 'bot',
        x: 780,
        y: PITCH_HEIGHT / 2,
      }),
      createPlayer({
        id: 'o2',
        side: 'away',
        slot: 1,
        role: 'def',
        kind: 'bot',
        x: 800,
        y: PITCH_HEIGHT / 2 + 20,
      }),
    ];
    const freeMate = createPlayer({
      id: 'm1',
      side: 'home',
      slot: 3,
      role: 'fwd',
      kind: 'bot',
      x: 720,
      y: 180,
    });

    const target = pickCarryTarget(carrier, [carrier, freeMate], blockers);
    assert.equal(target.x, PITCH_WIDTH);
    assert.ok(target.y < PITCH_HEIGHT / 2 - 20, 'should lean toward the open high lane / free mate');
  });
});

describe('updateBots presser tackle', () => {
  it('calls tryTackle when the presser is in range of the ball holder', () => {
    const presser = createPlayer({
      id: 'press',
      side: 'home',
      slot: 0,
      role: 'mid',
      kind: 'bot',
      x: 500,
      y: 320,
    });
    const holder = createPlayer({
      id: 'hold',
      side: 'away',
      slot: 0,
      role: 'mid',
      kind: 'human',
      x: 500 + TACKLE_RANGE - 4,
      y: 320,
    });
    const ball = createBall(holder.x, holder.y);
    const possession = createPossessionState();
    transferControl(possession, holder, 500);
    const players = [presser, holder];
    const anchors = [anchor(presser.x, presser.y, 0)];

    updateBots([presser], ball, possession, players, anchors, '4-4-2', 'home', 2000);

    assert.equal(possession.controllerId, presser.id);
    assert.ok(presser.lastTackleAt > 0);
  });

  it('does not tackle when the presser is out of range', () => {
    const presser = createPlayer({
      id: 'press',
      side: 'home',
      slot: 0,
      role: 'mid',
      kind: 'bot',
      x: 400,
      y: 320,
    });
    const holder = createPlayer({
      id: 'hold',
      side: 'away',
      slot: 0,
      role: 'mid',
      kind: 'human',
      x: 700,
      y: 320,
    });
    const ball = createBall(holder.x, holder.y);
    const possession = createPossessionState();
    transferControl(possession, holder, 500);
    const players = [presser, holder];
    const anchors = [anchor(presser.x, presser.y, 0)];

    updateBots([presser], ball, possession, players, anchors, '4-4-2', 'home', 2000);

    assert.equal(possession.controllerId, holder.id);
    assert.equal(presser.lastTackleAt, 0);
  });
});

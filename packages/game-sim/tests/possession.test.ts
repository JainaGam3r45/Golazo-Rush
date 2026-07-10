import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMatch, type MatchSnapshot } from '../src/index.ts';
import { createPossessionState, markBallKicked, transferControl, updatePossession } from '../src/possession.ts';
import { createBall, isBallIdle, setBallVelocity } from '../src/ball.ts';
import { createPlayer } from '../src/player.ts';
import { GOAL_BOTTOM, GOAL_DEPTH, GOAL_TOP, PITCH_WIDTH } from '../src/constants.ts';

describe('possession (instance state)', () => {
  it('does not share possession across matches', () => {
    const a = createMatch({ homeHumanPlayerId: 'a' });
    const b = createMatch({ homeHumanPlayerId: 'b' });

    for (let i = 0; i < 40; i++) {
      a.tick(16, { a: { dirx: 1, diry: 0, sprint: false, shoot: true, pass: false, clear: false, tackle: false, seq: i } });
    }

    const snapA = a.getSnapshot();
    const snapB = b.getSnapshot();
    assert.equal(snapB.tick, 0);
    assert.equal(snapB.ball.controllerId, null);
    assert.ok(snapA.tick > 0);
  });

  it('transfers control when a player is near an idle ball', () => {
    const possession = createPossessionState();
    const ball = createBall(400, 300);
    const player = createPlayer({
      id: 'p1',
      side: 'home',
      slot: 0,
      role: 'mid',
      kind: 'human',
      x: 410,
      y: 300,
    });

    updatePossession(possession, ball, [player], 1000);
    assert.equal(possession.ballState, 'controlled');
    assert.equal(possession.controllerId, 'p1');
    assert.equal(possession.lastTouchSide, 'home');
  });

  it('marks kicked state and releases controller', () => {
    const possession = createPossessionState();
    const player = createPlayer({
      id: 'p1',
      side: 'home',
      slot: 0,
      role: 'mid',
      kind: 'bot',
      x: 200,
      y: 200,
    });
    transferControl(possession, player, 100);
    markBallKicked(possession, 100);
    assert.equal(possession.ballState, 'kicked');
    assert.equal(possession.controllerId, null);
  });
});

describe('ball physics', () => {
  it('treats slow balls as idle', () => {
    const ball = createBall(100, 100);
    assert.equal(isBallIdle(ball), true);
    setBallVelocity(ball, 200, 0);
    assert.equal(isBallIdle(ball), false);
  });
});

describe('goal geometry constants', () => {
  it('keeps goal mouth within pitch', () => {
    assert.ok(GOAL_TOP < GOAL_BOTTOM);
    assert.ok(GOAL_DEPTH > 0);
    assert.ok(GOAL_DEPTH < PITCH_WIDTH / 2);
  });
});

describe('snapshot shape', () => {
  it('includes required network fields', () => {
    const snap: MatchSnapshot = createMatch({
      homeHumanPlayerId: 'h',
      awayHumanPlayerId: 'a',
    }).getSnapshot();

    assert.ok('tick' in snap);
    assert.ok('timeMs' in snap);
    assert.ok('clockSeconds' in snap);
    assert.ok('durationSeconds' in snap);
    assert.ok('phase' in snap);
    assert.ok('score' in snap);
    assert.ok('ball' in snap);
    assert.ok('players' in snap);
    assert.ok('humanSlots' in snap);
    assert.ok('state' in snap.ball);
    assert.ok('controllerId' in snap.ball);
  });
});

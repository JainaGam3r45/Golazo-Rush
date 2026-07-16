import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aimFromButtons,
  buttonsEqual,
  createInputSampler,
  mapKeysToButtons,
} from '../../src/lib/match/onlineInput.ts';
import { emptyButtons } from '../../src/lib/match/onlineProtocol.ts';
import {
  MAX_SNAP_BUFFER,
  clamp01,
  extrapolatePose,
  lerp,
  lerpPose,
  pushSnap,
  sampleInterpolatedFrame,
  softCorrect,
} from '../../src/lib/match/onlineInterp.ts';
import {
  parseMatchSnap,
  parseServerMessage,
  toWsUrl,
  toHttpUrl,
  buttonsToAxis,
} from '../../src/lib/match/onlineProtocol.ts';

describe('online input mapping', () => {
  it('maps held keys to protocol buttons', () => {
    const buttons = mapKeysToButtons({
      up: true,
      down: false,
      left: false,
      right: true,
      sprint: true,
      shoot: false,
      pass: true,
      tackle: false,
      clear: false,
    });
    assert.equal(buttons.up, true);
    assert.equal(buttons.right, true);
    assert.equal(buttons.sprint, true);
    assert.equal(buttons.pass, true);
    assert.equal(buttons.shoot, false);
  });

  it('edge-triggers action buttons in sampler', () => {
    const sampler = createInputSampler();
    const held = {
      up: false,
      down: false,
      left: false,
      right: false,
      sprint: false,
      shoot: true,
      pass: false,
      tackle: false,
      clear: false,
    };
    const first = sampler.sample(held);
    const second = sampler.sample(held);
    assert.equal(first.shoot, true);
    assert.equal(second.shoot, false);
  });

  it('computes aim from movement or side default', () => {
    const moving = aimFromButtons({ ...emptyButtons(), up: true }, 'home');
    assert.ok(Math.abs(moving - -Math.PI / 2) < 1e-9);
    assert.equal(aimFromButtons(emptyButtons(), 'home'), 0);
    assert.equal(aimFromButtons(emptyButtons(), 'away'), Math.PI);
  });

  it('compares button snapshots', () => {
    const a = emptyButtons();
    const b = emptyButtons();
    assert.equal(buttonsEqual(a, b), true);
    b.sprint = true;
    assert.equal(buttonsEqual(a, b), false);
  });
});

describe('online interpolation', () => {
  it('lerps and clamps', () => {
    assert.equal(lerp(0, 10, 0.5), 5);
    assert.equal(clamp01(1.5), 1);
    assert.equal(clamp01(-1), 0);
  });

  it('lerps poses and extrapolates with velocity', () => {
    const a = { x: 0, y: 0, vx: 0, vy: 0 };
    const b = { x: 10, y: 20, vx: 2, vy: 4 };
    assert.deepEqual(lerpPose(a, b, 0.5), { x: 5, y: 10, vx: 1, vy: 2 });
    assert.deepEqual(extrapolatePose(b, 1000), { x: 12, y: 24, vx: 2, vy: 4 });
  });

  it('soft-corrects toward authority', () => {
    const near = softCorrect({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 48);
    assert.deepEqual(near, { x: 5, y: 0 });
    const far = softCorrect({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 48);
    assert.deepEqual(far, { x: 100, y: 0 });
  });

  it('keeps interp buffer capped at two snaps', () => {
    assert.equal(MAX_SNAP_BUFFER, 2);
    const base = {
      tick: 0,
      phase: 'playing',
      clockMs: 0,
      durationSeconds: 900,
      half: 1 as const,
      score: { home: 0, away: 0 },
      ball: { x: 0, y: 0, vx: 0, vy: 0, controllerId: null, state: null },
      players: [],
      events: [],
      receivedAt: 0,
    };
    let buffer = pushSnap({ prev: null, next: null }, { ...base, tick: 1, receivedAt: 1 });
    buffer = pushSnap(buffer, { ...base, tick: 2, receivedAt: 2 });
    buffer = pushSnap(buffer, { ...base, tick: 3, receivedAt: 3 });
    buffer = pushSnap(buffer, { ...base, tick: 4, receivedAt: 4 });
    assert.equal(buffer.prev?.tick, 3);
    assert.equal(buffer.next?.tick, 4);
  });

  it('samples between two snaps', () => {
    const snapA = {
      tick: 1,
      phase: 'playing',
      clockMs: 1000,
      durationSeconds: 900,
      half: 1 as const,
      score: { home: 0, away: 0 },
      ball: { x: 0, y: 0, vx: 0, vy: 0, controllerId: null, state: null },
      players: [
        {
          id: 'p1',
          side: 'home' as const,
          slot: 0,
          kind: 'human' as const,
          userId: 'u1',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
        },
      ],
      events: [],
      receivedAt: 1000,
    };
    const snapB = {
      ...snapA,
      tick: 2,
      ball: {
        x: 100,
        y: 0,
        vx: 0,
        vy: 0,
        controllerId: 'p1',
        state: 'controlled',
      },
      players: [{ ...snapA.players[0], x: 100, y: 0 }],
      receivedAt: 1100,
    };
    let buffer = pushSnap({ prev: null, next: null }, snapA);
    buffer = pushSnap(buffer, snapB);
    const frame = sampleInterpolatedFrame(buffer, 1150, 100);
    assert.ok(frame);
    assert.ok(frame.ball.x > 0 && frame.ball.x < 100);
    assert.equal(frame.ball.controllerId, 'p1');
    assert.equal(frame.ball.state, 'controlled');
  });
});

describe('online protocol parsing', () => {
  it('maps buttons to probe axis', () => {
    assert.deepEqual(buttonsToAxis({ ...emptyButtons(), right: true }), { x: 1, y: 0 });
    const diag = buttonsToAxis({ ...emptyButtons(), up: true, right: true });
    assert.ok(Math.abs(diag.x - Math.SQRT1_2) < 1e-9);
    assert.ok(Math.abs(diag.y + Math.SQRT1_2) < 1e-9);
  });

  it('parses flexible snap envelopes', () => {
    const msg = parseServerMessage({
      t: 'snap',
      tick: 9,
      clockMs: 5000,
      score: { home: 1, away: 2 },
      ball: { x: 10, y: 20, vx: 1, vy: 2 },
      players: [{ id: 'a', side: 'away', slot: 1, kind: 'bot', x: 3, y: 4 }],
    });
    assert.ok(msg);
    const snap = parseMatchSnap(msg!, 123);
    assert.ok(snap);
    assert.equal(snap.tick, 9);
    assert.equal(snap.score.away, 2);
    assert.equal(snap.players[0].side, 'away');
    assert.equal(snap.receivedAt, 123);
    assert.equal(snap.ball.controllerId, null);
    assert.equal(snap.ball.state, null);
  });

  it('parses ball controllerId and state from wire', () => {
    const msg = parseServerMessage({
      t: 'matchSnapshot',
      tick: 4,
      ball: {
        x: 100,
        y: 200,
        vx: 0,
        vy: 0,
        state: 'controlled',
        controllerId: 'home:3',
      },
      players: [],
      score: { home: 0, away: 0 },
    });
    const snap = parseMatchSnap(msg!, 50);
    assert.ok(snap);
    assert.equal(snap.ball.controllerId, 'home:3');
    assert.equal(snap.ball.state, 'controlled');
    assert.equal(snap.ball.x, 100);
  });

  it('parses matchSnapshot stub without poses', () => {
    const msg = parseServerMessage({
      t: 'matchSnapshot',
      tick: 3,
      serverTime: 1,
      state: { stub: true, players: [{ userId: 'a', side: 'home' }] },
    });
    const snap = parseMatchSnap(msg!, 1);
    assert.ok(snap);
    assert.equal(snap.stub, true);
    assert.equal(snap.players.length, 0);
  });

  it('converts http(s) base URLs to ws(s)', () => {
    assert.equal(toWsUrl('https://example.com/game/'), 'wss://example.com/game');
    assert.equal(toWsUrl('http://localhost:8080'), 'ws://localhost:8080');
    assert.equal(toWsUrl('wss://already'), 'wss://already');
    assert.equal(toHttpUrl('wss://example.com/game/'), 'https://example.com/game');
    assert.equal(toHttpUrl('ws://localhost:8080'), 'http://localhost:8080');
    assert.equal(toHttpUrl('https://already'), 'https://already');
  });
});

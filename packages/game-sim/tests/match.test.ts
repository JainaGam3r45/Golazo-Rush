import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMatch,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  TEAM_SIZE_11V11,
  HALFTIME_PAUSE_MS,
  MATCH_TIME_SCALE,
  type PlayerInput,
} from '../src/index.ts';
import { GOAL_DEPTH } from '../src/constants.ts';

function input(partial: Partial<PlayerInput> & { seq: number }): PlayerInput {
  return {
    dirx: 0,
    diry: 0,
    sprint: false,
    shoot: false,
    pass: false,
    clear: false,
    tackle: false,
    ...partial,
  };
}

describe('createMatch', () => {
  it('falls back to the default duration when given a non-positive value', () => {
    const match = createMatch({
      humanAssignments: [{ playerId: 'h1', side: 'home', fieldSlot: 0 }],
      durationSeconds: 0,
    });
    assert.equal(match.getSnapshot().durationSeconds, 900);
  });

  it('spawns multi-human assignments on distinct field slots', () => {
    const match = createMatch({
      humanAssignments: [
        { playerId: 'h1', side: 'home', fieldSlot: 0 },
        { playerId: 'h2', side: 'home', fieldSlot: 1 },
        { playerId: 'a1', side: 'away', fieldSlot: 0 },
      ],
      durationSeconds: 60,
    });
    const snap = match.getSnapshot();
    assert.equal(snap.players.filter((p) => p.kind === 'human').length, 3);
    assert.equal(snap.humanAssignments.length, 3);
    assert.ok(snap.players.some((p) => p.id === 'h2' && p.side === 'home' && p.slot === 1));
    assert.equal(snap.humanSlots.home, 'h1');
    assert.equal(snap.humanSlots.away, 'a1');
  });

  it('spawns an 11v11 roster with one human per side when ids are provided', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      awayHumanPlayerId: 'p-away',
      durationSeconds: 60,
    });
    const snap = match.getSnapshot();

    assert.equal(snap.players.length, TEAM_SIZE_11V11 * 2);
    assert.equal(snap.humanSlots.home, 'p-home');
    assert.equal(snap.humanSlots.away, 'p-away');
    assert.equal(snap.phase, 'playing');
    assert.equal(snap.score.home, 0);
    assert.equal(snap.score.away, 0);
    assert.equal(snap.players.filter((p) => p.kind === 'human').length, 2);
    assert.equal(snap.players.filter((p) => p.role === 'gk').length, 2);
    assert.ok(snap.ball.x > 0 && snap.ball.x < PITCH_WIDTH);
    assert.ok(snap.ball.y > 0 && snap.ball.y < PITCH_HEIGHT);
  });

  it('accepts a custom 10-player lineup', () => {
    const lineup = Array.from({ length: 10 }, (_, i) => ({
      nx: 0.2 + (i % 5) * 0.06,
      ny: 0.2 + Math.floor(i / 5) * 0.4,
      role: 'mid' as const,
    }));
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      homeLineup: lineup,
      durationSeconds: 60,
    });
    assert.equal(match.getSnapshot().players.length, TEAM_SIZE_11V11 * 2);
  });

  it('keeps independent state across match instances', () => {
    const a = createMatch({ homeHumanPlayerId: 'a', durationSeconds: 60 });
    const b = createMatch({ homeHumanPlayerId: 'b', durationSeconds: 60 });

    a.tick(16, { a: input({ dirx: 1, seq: 1 }) });
    const snapA = a.getSnapshot();
    const snapB = b.getSnapshot();

    assert.notEqual(snapA.tick, snapB.tick);
    assert.equal(snapB.tick, 0);
    assert.equal(snapB.phase, 'playing');
  });
});

describe('tick + inputs', () => {
  it('moves the home human from directional input', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      awayHumanPlayerId: 'p-away',
      durationSeconds: 120,
    });
    const before = match.getSnapshot().players.find((p) => p.id === 'p-home')!;

    for (let i = 0; i < 30; i++) {
      match.tick(16, { 'p-home': input({ dirx: 1, diry: 0, seq: i + 1 }) });
    }

    const after = match.getSnapshot().players.find((p) => p.id === 'p-home')!;
    assert.ok(after.x > before.x, `expected x to increase (${before.x} -> ${after.x})`);
  });

  it('accepts applyInput before tick', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      durationSeconds: 60,
    });
    const before = match.getSnapshot().players.find((p) => p.id === 'p-home')!;
    match.applyInput('p-home', input({ dirx: 1, seq: 1 }));
    match.tick(16);
    const after = match.getSnapshot().players.find((p) => p.id === 'p-home')!;
    assert.ok(after.x > before.x);
  });

  it('ignores stale input sequences', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      durationSeconds: 60,
    });

    match.tick(16, { 'p-home': input({ dirx: 1, seq: 5 }) });
    const mid = match.getSnapshot().players.find((p) => p.id === 'p-home')!;
    match.tick(16, { 'p-home': input({ dirx: -1, seq: 4 }) });
    const after = match.getSnapshot().players.find((p) => p.id === 'p-home')!;

    // Stale seq should not reverse direction; player may coast or keep prior intent.
    assert.ok(after.x >= mid.x - 1);
  });
});

describe('clock and finish', () => {
  it('scales match time, pauses at half-time, then finishes in the second half', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      durationSeconds: 20,
    });

    for (let i = 0; i < 20; i++) match.tick(50);
    let snap = match.getSnapshot();
    assert.equal(snap.phase, 'halftime');
    assert.equal(snap.half, 1);
    assert.equal(snap.clockSeconds, 10);

    for (let i = 0; i < HALFTIME_PAUSE_MS / 50; i++) match.tick(50);
    snap = match.getSnapshot();
    assert.equal(snap.phase, 'playing');
    assert.equal(snap.half, 2);

    for (let i = 0; i < 20; i++) match.tick(50);

    snap = match.getSnapshot();
    assert.equal(MATCH_TIME_SCALE, 10);
    assert.ok(snap.clockSeconds >= 20);
    assert.equal(snap.phase, 'finished');
    assert.equal(match.isFinished(), true);
  });
});

describe('goals', () => {
  it('scores when the ball enters the goal mouth and resumes after pause', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      awayHumanPlayerId: 'p-away',
      durationSeconds: 180,
      initialBall: {
        x: PITCH_WIDTH - GOAL_DEPTH + 2,
        y: PITCH_HEIGHT / 2,
        vx: 80,
        vy: 0,
      },
    });

    const snap = match.tick(16);
    assert.equal(snap.score.home, 1);
    assert.equal(snap.phase, 'goal');

    let resumed = match.getSnapshot();
    for (let i = 0; i < 100; i++) resumed = match.tick(16);
    assert.equal(resumed.phase, 'playing');
  });
});

describe('snapshot', () => {
  it('returns JSON-serializable snapshots', () => {
    const match = createMatch({
      homeHumanPlayerId: 'p-home',
      awayHumanPlayerId: 'p-away',
    });
    match.tick(16, { 'p-home': input({ dirx: 0.5, seq: 1 }) });
    const snap = match.getSnapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json);
    assert.equal(parsed.tick, snap.tick);
    assert.equal(parsed.players.length, snap.players.length);
    assert.equal(parsed.ball.state, snap.ball.state);
  });
});

describe('bots', () => {
  it('moves bot players over time without human input', () => {
    const match = createMatch({ durationSeconds: 60 });
    const before = match.getSnapshot().players.filter((p) => p.kind === 'bot' && p.role !== 'gk');
    const beforePos = before.map((p) => ({ id: p.id, x: p.x, y: p.y }));

    for (let i = 0; i < 60; i++) match.tick(16);

    const after = match.getSnapshot().players.filter((p) => p.kind === 'bot' && p.role !== 'gk');
    let moved = 0;
    for (const p of after) {
      const prev = beforePos.find((b) => b.id === p.id)!;
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 2) moved += 1;
    }
    assert.ok(moved >= 2, `expected bots to move, moved=${moved}`);
  });
});

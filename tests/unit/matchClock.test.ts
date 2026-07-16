import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MATCH_TIME_SCALE,
  MAX_CLOCK_ELAPSED_MS,
  tickMatchClock,
  validateDuration,
} from '../../src/lib/match/durations.ts';

describe('tickMatchClock', () => {
  it('advances match clock with the arcade time scale', () => {
    const tick = tickMatchClock({
      matchClockSeconds: 0,
      elapsedMs: 100,
      durationSeconds: 600,
      half: 1,
    });
    assert.equal(tick.skipped, false);
    assert.equal(tick.matchClockSeconds, 1);
    assert.equal(tick.remaining, 599);
    assert.equal(tick.shouldEnd, false);
    assert.equal(tick.shouldHalftime, false);
  });

  it('does not burn the match on a huge boot/stall catch-up delta', () => {
    const tick = tickMatchClock({
      matchClockSeconds: 0,
      elapsedMs: 60_000,
      durationSeconds: 600,
      half: 1,
    });
    assert.equal(tick.skipped, true);
    assert.equal(tick.matchClockSeconds, 0);
    assert.equal(tick.remaining, 600);
    assert.equal(tick.shouldEnd, false);
    assert.ok(60_000 > MAX_CLOCK_ELAPSED_MS);
    assert.equal(MATCH_TIME_SCALE, 10);
  });

  it('ends only after the full match clock elapses under normal ticks', () => {
    let clock = 0;
    let ended = false;
    // 60s real × scale 10 = 600 match seconds for a 10-min match.
    for (let i = 0; i < 600; i++) {
      const tick = tickMatchClock({
        matchClockSeconds: clock,
        elapsedMs: 100,
        durationSeconds: 600,
        half: 2,
      });
      clock = tick.matchClockSeconds;
      if (tick.shouldEnd) {
        ended = true;
        break;
      }
    }
    assert.equal(ended, true);
    assert.ok(clock >= 600);
  });

  it('signals halftime at the midpoint of the first half', () => {
    const tick = tickMatchClock({
      matchClockSeconds: 299,
      elapsedMs: 100,
      durationSeconds: 600,
      half: 1,
    });
    assert.equal(tick.shouldHalftime, true);
    assert.equal(tick.shouldEnd, false);
  });
});

describe('validateDuration', () => {
  it('rejects zero and other invalid durations that would finish instantly', () => {
    assert.equal(validateDuration(0), 900);
    assert.equal(validateDuration(-1), 900);
    assert.equal(validateDuration(60), 900);
    assert.equal(validateDuration(600), 600);
  });
});

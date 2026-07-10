import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALLOWED_DURATIONS,
  DEFAULT_DURATION,
  validateDuration,
} from '../../src/lib/match/durations.ts';

describe('match duration setup', () => {
  it('allows the four user-facing match durations', () => {
    assert.deepEqual(ALLOWED_DURATIONS, [600, 900, 1800, 2700]);
    for (const duration of ALLOWED_DURATIONS) {
      assert.equal(validateDuration(duration), duration);
    }
  });

  it('falls back to the fifteen-minute default for invalid durations', () => {
    assert.equal(DEFAULT_DURATION, 900);
    assert.equal(validateDuration(180), DEFAULT_DURATION);
    assert.equal(validateDuration(0), DEFAULT_DURATION);
    assert.equal(validateDuration('900'), DEFAULT_DURATION);
  });
});

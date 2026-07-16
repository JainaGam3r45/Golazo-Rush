import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALLOWED_DURATIONS,
  DEFAULT_DURATION,
  validateDuration,
} from '../../src/lib/match/durations.ts';

describe('match duration setup', () => {
  it('allows the four user-facing match durations', () => {
    for (const duration of ALLOWED_DURATIONS) {
      assert.equal(validateDuration(duration), duration);
    }
  });

  it('falls back to the fifteen-minute default for invalid durations', () => {
    assert.equal(validateDuration(0), DEFAULT_DURATION);
    assert.equal(validateDuration(10), DEFAULT_DURATION);
    assert.equal(validateDuration('600'), DEFAULT_DURATION);
    assert.equal(validateDuration(undefined), DEFAULT_DURATION);
  });
});

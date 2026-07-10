import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneDefaultLineup,
  normalizeLineup,
  chatMessageDedupeKey,
  LINEUP_OUTFIELD_COUNT,
} from '../../src/lib/match/lineup.ts';

describe('lineup', () => {
  it('clones a 10-slot default lineup', () => {
    const a = cloneDefaultLineup();
    const b = cloneDefaultLineup();
    assert.equal(a.length, LINEUP_OUTFIELD_COUNT);
    a[0].nx = 0.99;
    assert.notEqual(b[0].nx, 0.99);
  });

  it('normalizes and rejects bad lineups', () => {
    assert.equal(normalizeLineup([]), null);
    const ok = normalizeLineup(cloneDefaultLineup());
    assert.ok(ok);
    assert.equal(ok!.length, 10);
  });

  it('dedupes chat keys', () => {
    const key = chatMessageDedupeKey({
      userId: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      body: 'hola',
    });
    assert.equal(key, 'u1|2026-01-01T00:00:00Z|hola');
  });
});

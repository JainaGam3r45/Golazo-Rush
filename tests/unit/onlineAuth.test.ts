import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessTokenFromRefreshPayload,
  parseBearerToken,
} from '../../src/lib/match/onlineAuthToken.ts';

describe('onlineAuthToken parseBearerToken', () => {
  it('extracts bearer tokens', () => {
    assert.equal(parseBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.equal(parseBearerToken('bearer xyz'), 'xyz');
  });

  it('rejects missing or malformed headers', () => {
    assert.equal(parseBearerToken(null), null);
    assert.equal(parseBearerToken(undefined), null);
    assert.equal(parseBearerToken(''), null);
    assert.equal(parseBearerToken('Token abc'), null);
    assert.equal(parseBearerToken('Bearer'), null);
    assert.equal(parseBearerToken('Bearer '), null);
  });

  it('rejects anon key and other listed tokens', () => {
    const anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon';
    assert.equal(parseBearerToken(`Bearer ${anon}`, [anon]), null);
    assert.equal(parseBearerToken(`Bearer ${anon}`, [null, anon]), null);
    assert.equal(parseBearerToken(`Bearer user-jwt-token`, [anon]), 'user-jwt-token');
  });
});

describe('onlineAuthToken accessTokenFromRefreshPayload', () => {
  it('reads accessToken and rejects listed tokens', () => {
    assert.equal(accessTokenFromRefreshPayload({ accessToken: 'user-jwt' }), 'user-jwt');
    assert.equal(accessTokenFromRefreshPayload({ accessToken: '  ' }), null);
    assert.equal(accessTokenFromRefreshPayload(null), null);
    assert.equal(accessTokenFromRefreshPayload({ accessToken: 'anon' }, ['anon']), null);
  });
});

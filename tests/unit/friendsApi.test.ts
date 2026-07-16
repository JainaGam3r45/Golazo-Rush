import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapFriendRpcError, FRIEND_ERROR_MESSAGES } from '../../src/lib/friends/friendsErrors.ts';
import { friendDisplayLabel, roomInviteText } from '../../src/lib/friends/types.ts';

describe('friendsApi error mapping', () => {
  it('maps known friendship RPC codes to Spanish copy', () => {
    assert.deepEqual(mapFriendRpcError('ERROR: USER_NOT_FOUND'), {
      code: 'USER_NOT_FOUND',
      message: FRIEND_ERROR_MESSAGES.USER_NOT_FOUND,
    });
    assert.equal(mapFriendRpcError('NOT_FRIENDS').message, FRIEND_ERROR_MESSAGES.NOT_FRIENDS);
    assert.equal(mapFriendRpcError('something else').code, 'INTERNAL_ERROR');
  });
});

describe('friends helpers', () => {
  it('prefers displayName then username then short id', () => {
    assert.equal(
      friendDisplayLabel({ displayName: 'Golazo', username: 'g', userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      'Golazo',
    );
    assert.equal(
      friendDisplayLabel({ displayName: null, username: 'neo', userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      'neo',
    );
    assert.equal(
      friendDisplayLabel({ displayName: null, username: null, userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      'aaaaaaaa',
    );
  });

  it('builds a shareable room invite with accents', () => {
    const text = roomInviteText('ABC234', 'https://example.com');
    assert.match(text, /¡Únete a mi sala en Golazo Rush!/);
    assert.match(text, /Código ABC234/);
    assert.match(text, /https:\/\/example\.com\/play\?room=ABC234/);
  });
});

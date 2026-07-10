import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoomRpcCall,
  mapRoomRpcErrorMessage,
  selectRoomTransport,
} from '../../src/lib/match/privateRoomRpc.ts';

describe('privateRoomApi transport routing', () => {
  it('prefers authenticated InsForge RPC when configured', () => {
    assert.equal(
      selectRoomTransport({
        insforgeConfigured: true,
        gameServerUrl: 'https://game.example.com',
      }),
      'rpc',
    );
    assert.equal(
      selectRoomTransport({
        insforgeConfigured: true,
        gameServerUrl: null,
      }),
      'rpc',
    );
  });

  it('uses optional game-server only when InsForge is unavailable', () => {
    assert.equal(
      selectRoomTransport({
        insforgeConfigured: false,
        gameServerUrl: 'https://game.example.com',
      }),
      'game-server',
    );
    assert.equal(
      selectRoomTransport({
        insforgeConfigured: false,
        gameServerUrl: null,
      }),
      'none',
    );
  });
});

describe('privateRoomApi auth RPC mapping', () => {
  it('maps create/join/start without client user id params', () => {
    const create = buildRoomRpcCall('create', {
      teamId: 'arg',
      formationId: '4-3-3',
      durationSeconds: 120,
    });
    assert.ok(!('error' in create));
    assert.equal(create.fn, 'create_private_room_auth');
    assert.deepEqual(create.args, {
      p_team_id: 'arg',
      p_formation_id: '4-3-3',
      p_duration_seconds: 120,
    });
    assert.equal(create.shape, 'room');

    const join = buildRoomRpcCall('join', {
      code: 'ABC234',
      teamId: 'bra',
    });
    assert.ok(!('error' in join));
    assert.equal(join.fn, 'join_private_room_auth');
    assert.equal(join.args.p_code, 'ABC234');
    assert.equal(Object.keys(join.args).includes('p_user_id'), false);

    const start = buildRoomRpcCall('start', { roomId: '11111111-1111-1111-1111-111111111111' });
    assert.ok(!('error' in start));
    assert.equal(start.fn, 'start_private_room_auth');
  });

  it('maps chat to publish_room_chat_auth and sanitizes body', () => {
    const chat = buildRoomRpcCall('chat', {
      roomId: '11111111-1111-1111-1111-111111111111',
      message: '  hola <b>mundo</b>  ',
    });
    assert.ok(!('error' in chat));
    assert.equal(chat.fn, 'publish_room_chat_auth');
    assert.equal(chat.args.p_body, 'hola bmundo/b');
    assert.equal(chat.shape, 'message');
  });

  it('rejects empty chat and unknown actions', () => {
    const empty = buildRoomRpcCall('chat', {
      roomId: '11111111-1111-1111-1111-111111111111',
      message: '   ',
    });
    assert.ok('error' in empty);
    assert.equal(empty.error.code, 'EMPTY_MESSAGE');

    const bad = buildRoomRpcCall('nope', {});
    assert.ok('error' in bad);
    assert.equal(bad.error.code, 'INVALID_ACTION');
  });
});

describe('privateRoomApi RPC error mapping', () => {
  it('extracts SQL exception codes from PostgREST messages', () => {
    assert.deepEqual(mapRoomRpcErrorMessage('P0001: ROOM_FULL'), {
      code: 'ROOM_FULL',
      message: 'La sala ya tiene dos jugadores',
    });
    assert.equal(mapRoomRpcErrorMessage('RATE_LIMITED').code, 'RATE_LIMITED');
    assert.equal(mapRoomRpcErrorMessage('something else').code, 'INTERNAL_ERROR');
  });
});

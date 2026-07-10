import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { connect, onceMessage, closeAll, closeQuiet } from './helpers/wsClient.mjs';
import {
  startLocalServer,
  DEFAULT_ORIGIN,
  DEFAULT_TEST_TOKEN,
} from './helpers/startLocalServer.mjs';

/** @type {Awaited<ReturnType<typeof startLocalServer>>} */
let server;

before(async () => {
  server = await startLocalServer();
});

after(async () => {
  await closeAll();
  if (server) await server.stop();
});

afterEach(async () => {
  await closeAll();
});

describe('mp ws acceptance', () => {
  it('health', async () => {
    const res = await fetch(`${server.base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'golazo-game-server');
    assert.equal(typeof body.rooms, 'number');
  });

  it('two clients join and exchange probeState', async () => {
    const roomId = `two-${Date.now()}`;
    const a = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    const b = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });

    a.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    const joinedA = await onceMessage(a, (m) => m.t === 'joined');
    assert.equal(joinedA.roomId, roomId);
    assert.equal(typeof joinedA.connectionId, 'string');

    const peerOnA = onceMessage(a, (m) => m.t === 'peerJoined');
    const peerOnB = onceMessage(b, (m) => m.t === 'peerJoined');
    b.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    const joinedB = await onceMessage(b, (m) => m.t === 'joined');
    assert.equal(joinedB.roomId, roomId);
    await peerOnA;
    await peerOnB;

    const stateOnB = onceMessage(b, (m) => m.t === 'probeState' && m.seq === 1);
    a.send(JSON.stringify({ t: 'probeInput', seq: 1, x: 0.25, y: -0.5 }));
    const state = await stateOnB;
    assert.equal(state.clients, 2);

    await closeQuiet(a);
    await closeQuiet(b);
  });

  it('third reject ROOM_FULL', async () => {
    const roomId = `full-${Date.now()}`;
    const a = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    const b = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    const c = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });

    a.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    await onceMessage(a, (m) => m.t === 'joined');
    const peerP = onceMessage(a, (m) => m.t === 'peerJoined');
    b.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    await onceMessage(b, (m) => m.t === 'joined');
    await peerP;

    const errP = onceMessage(c, (m) => m.t === 'error' && m.code === 'ROOM_FULL');
    c.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    await errP;

    await closeQuiet(a);
    await closeQuiet(b);
    await closeQuiet(c);
  });

  it('bad token UNAUTHORIZED', async () => {
    const ws = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    const errP = onceMessage(ws, (m) => m.t === 'error');
    ws.send(JSON.stringify({ t: 'join', roomId: 'bad-token', token: 'wrong-token' }));
    const err = await errP;
    assert.equal(err.code, 'UNAUTHORIZED');
    await closeQuiet(ws);
  });

  it('bad origin 403 on upgrade', async () => {
    await assert.rejects(
      () => connect(server.wsUrl, { origin: 'https://evil.example' }),
      (err) => err.statusCode === 403 || /403|Unexpected server response: 403/.test(String(err)),
    );
  });

  it('ping/pong', async () => {
    const ws = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    ws.send(JSON.stringify({ t: 'join', roomId: `ping-${Date.now()}`, token: DEFAULT_TEST_TOKEN }));
    await onceMessage(ws, (m) => m.t === 'joined');
    const pongP = onceMessage(ws, (m) => m.t === 'pong');
    ws.send(JSON.stringify({ t: 'ping', clientTime: 123 }));
    const pong = await pongP;
    assert.equal(pong.clientTime, 123);
    assert.equal(typeof pong.serverTime, 'number');
    await closeQuiet(ws);
  });

  it('room isolation probeInput', async () => {
    const a = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    const b = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    a.send(JSON.stringify({ t: 'join', roomId: `iso-a-${Date.now()}`, token: DEFAULT_TEST_TOKEN }));
    b.send(JSON.stringify({ t: 'join', roomId: `iso-b-${Date.now()}`, token: DEFAULT_TEST_TOKEN }));
    await onceMessage(a, (m) => m.t === 'joined');
    await onceMessage(b, (m) => m.t === 'joined');

    let leaked = false;
    b.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m.t === 'probeState' && m.seq === 99) leaked = true;
      } catch {
        /* ignore */
      }
    });
    a.send(JSON.stringify({ t: 'probeInput', seq: 99, x: 0.5, y: -1 }));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(leaked, false);
    await closeQuiet(a);
    await closeQuiet(b);
  });

  it('cleanup disconnect empties room', async () => {
    const roomId = `cleanup-${Date.now()}`;
    const health0 = await (await fetch(`${server.base}/health`)).json();
    const roomsBefore = health0.rooms;

    const a = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    const b = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    a.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    await onceMessage(a, (m) => m.t === 'joined');
    b.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    await onceMessage(b, (m) => m.t === 'joined');

    const health1 = await (await fetch(`${server.base}/health`)).json();
    assert.ok(health1.rooms >= roomsBefore + 1);

    await closeQuiet(a);
    await closeQuiet(b);
    await new Promise((r) => setTimeout(r, 80));

    const health2 = await (await fetch(`${server.base}/health`)).json();
    assert.equal(health2.rooms, roomsBefore);

    const c = await connect(server.wsUrl, { origin: DEFAULT_ORIGIN });
    c.send(JSON.stringify({ t: 'join', roomId, token: DEFAULT_TEST_TOKEN }));
    const joined = await onceMessage(c, (m) => m.t === 'joined');
    assert.equal(joined.roomId, roomId);
    await closeQuiet(c);
  });
});
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { loadConfig, isOriginAllowed } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createTestAuthVerifier } from '../src/auth.js';
import { createGameServer } from '../src/server.js';
import { createStubMatchHost } from '../src/matchHost.js';
import { RoomRegistry, checkRateLimit } from '../src/rooms.js';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startProbe(overrides = {}) {
  const port = await freePort();
  const config = loadConfig({
    NODE_ENV: 'development',
    PORT: String(port),
    WS_AUTH_MODE: 'test',
    WS_TEST_TOKEN: 'test-token-abc',
    ALLOWED_ORIGINS: 'http://localhost:4321,http://allowed.test',
    INSFORGE_BASE_URL: 'https://example.insforge.app',
    PUBLIC_APP_ORIGIN: 'http://localhost:4321',
    LOG_LEVEL: 'error',
    HEARTBEAT_TIMEOUT_MS: '2000',
    HEARTBEAT_INTERVAL_MS: '500',
    ...overrides,
  });
  const log = createLogger('error');
  const game = await createGameServer({
    config,
    log,
    authVerifier: createTestAuthVerifier(config.testToken),
    matchHost: createStubMatchHost(),
  });
  await game.listen({ port });
  return { game, port, config, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
}

function connect(wsUrl, { origin, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, origin ? { origin } : undefined);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      const err = new Error(`unexpected ${res.statusCode}`);
      err.statusCode = res.statusCode;
      reject(err);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function onceMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('message timeout'));
    }, timeoutMs);
    function onMsg(raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!predicate || predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

describe('config', () => {
  it('rejects test auth in production', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          PORT: '8080',
          WS_AUTH_MODE: 'test',
          ALLOWED_ORIGINS: 'https://app.example',
          PUBLIC_APP_ORIGIN: 'https://app.example',
          INSFORGE_BASE_URL: 'https://x.insforge.app',
        }),
      /not allowed in production/,
    );
  });

  it('allows localhost origins in development', () => {
    const cfg = loadConfig({
      NODE_ENV: 'development',
      PORT: '8787',
      WS_AUTH_MODE: 'test',
      WS_TEST_TOKEN: 't',
      INSFORGE_BASE_URL: 'https://x.insforge.app',
    });
    assert.equal(isOriginAllowed('http://localhost:4321', cfg), true);
    assert.equal(isOriginAllowed('https://evil.example', cfg), false);
  });
});

describe('rooms registry', () => {
  it('removes empty rooms', () => {
    const reg = new RoomRegistry();
    const fake = { readyState: 1 };
    const { conn } = reg.join('r1', fake, 'u1');
    assert.equal(reg.roomCount(), 1);
    const left = reg.leave('r1', conn.connectionId);
    assert.equal(left.empty, true);
    assert.equal(reg.roomCount(), 0);
  });

  it('rate limits', () => {
    const conn = {
      msgWindowStart: Date.now(),
      msgCount: 0,
    };
    for (let i = 0; i < 5; i++) assert.equal(checkRateLimit(conn, 5), true);
    assert.equal(checkRateLimit(conn, 5), false);
  });
});

describe('game-server probe', () => {
  /** @type {Awaited<ReturnType<typeof startProbe>>} */
  let ctx;

  beforeEach(async () => {
    ctx = await startProbe();
  });

  afterEach(async () => {
    await ctx.game.close();
  });

  it('GET /health', async () => {
    const res = await fetch(`${ctx.base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'golazo-game-server');
  });

  it('valid connect and join', async () => {
    const ws = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const joinedP = onceMessage(ws, (m) => m.t === 'joined');
    ws.send(JSON.stringify({ t: 'join', roomId: 'room-a', token: 'test-token-abc' }));
    const joined = await joinedP;
    assert.equal(joined.roomId, 'room-a');
    assert.ok(joined.connectionId);
    ws.close();
  });

  it('rejects invalid origin', async () => {
    await assert.rejects(
      () => connect(ctx.wsUrl, { origin: 'https://evil.example' }),
      (err) => err.statusCode === 403 || /403|Unexpected server response: 403/.test(String(err)),
    );
  });

  it('rejects invalid token', async () => {
    const ws = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const errP = onceMessage(ws, (m) => m.t === 'error');
    ws.send(JSON.stringify({ t: 'join', roomId: 'r', token: 'wrong' }));
    const err = await errP;
    assert.equal(err.code, 'UNAUTHORIZED');
    ws.close();
  });

  it('rejects invalid JSON', async () => {
    const ws = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const errP = onceMessage(ws, (m) => m.t === 'error' && m.code === 'INVALID_JSON');
    ws.send('{not-json');
    await errP;
    ws.close();
  });

  it('rejects oversized message', async () => {
    const ws = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const big = 'x'.repeat(ctx.config.maxMessageBytes + 100);
    const closed = new Promise((resolve) => ws.once('close', resolve));
    ws.send(JSON.stringify({ t: 'join', roomId: 'r', token: big }));
    await closed;
  });

  it('ping/pong', async () => {
    const ws = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    ws.send(JSON.stringify({ t: 'join', roomId: 'ping-room', token: 'test-token-abc' }));
    await onceMessage(ws, (m) => m.t === 'joined');
    const pongP = onceMessage(ws, (m) => m.t === 'pong');
    ws.send(JSON.stringify({ t: 'ping', clientTime: 123 }));
    const pong = await pongP;
    assert.equal(pong.clientTime, 123);
    assert.equal(typeof pong.serverTime, 'number');
    ws.close();
  });

  it('allows up to maxPerRoom clients then rejects', async () => {
    const sockets = [];
    for (let i = 0; i < 10; i++) {
      const ws = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
      sockets.push(ws);
      ws.send(
        JSON.stringify({
          t: 'join',
          roomId: 'cap',
          token: `test:user-${i}`,
          role: i < 4 ? 'player' : 'spectator',
        }),
      );
      await onceMessage(ws, (m) => m.t === 'joined');
    }
    const overflow = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const errP = onceMessage(overflow, (m) => m.t === 'error' && m.code === 'ROOM_FULL');
    overflow.send(
      JSON.stringify({ t: 'join', roomId: 'cap', token: 'test:overflow', role: 'spectator' }),
    );
    await errP;
    for (const ws of sockets) ws.close();
    overflow.close();
  });

  it('spectator join receives role and cannot send input', async () => {
    const player = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const spectator = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });

    player.send(
      JSON.stringify({ t: 'join', roomId: 'spec-room', token: 'test:player-a', role: 'player' }),
    );
    await onceMessage(player, (m) => m.t === 'joined');

    const joinedP = onceMessage(
      spectator,
      (m) => m.t === 'joined' && m.role === 'spectator',
    );
    spectator.send(
      JSON.stringify({
        t: 'join',
        roomId: 'spec-room',
        token: 'test:spec-a',
        role: 'spectator',
      }),
    );
    await joinedP;

    const errP = onceMessage(
      spectator,
      (m) => m.t === 'error' && m.code === 'SPECTATOR_READONLY',
    );
    spectator.send(JSON.stringify({ t: 'probeInput', seq: 1, x: 1, y: 0 }));
    await errP;

    const matchErrP = onceMessage(
      spectator,
      (m) => m.t === 'error' && m.code === 'SPECTATOR_READONLY',
    );
    spectator.send(JSON.stringify({ t: 'matchJoin', side: 'home', fieldSlot: 0 }));
    await matchErrP;

    player.close();
    spectator.close();
  });

  it('late spectator receives snapshot when match already started', async () => {
    const home = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const away = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });

    home.send(JSON.stringify({ t: 'join', roomId: 'late-spec', token: 'test:home', role: 'player' }));
    await onceMessage(home, (m) => m.t === 'joined');
    away.send(JSON.stringify({ t: 'join', roomId: 'late-spec', token: 'test:away', role: 'player' }));
    await onceMessage(away, (m) => m.t === 'joined');

    home.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'home',
        fieldSlot: 0,
        humans: [
          { userId: 'home', side: 'home', fieldSlot: 0 },
          { userId: 'away', side: 'away', fieldSlot: 0 },
        ],
      }),
    );
    await onceMessage(home, (m) => m.t === 'matchJoined');
    away.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'away',
        fieldSlot: 0,
        humans: [
          { userId: 'home', side: 'home', fieldSlot: 0 },
          { userId: 'away', side: 'away', fieldSlot: 0 },
        ],
      }),
    );
    await onceMessage(away, (m) => m.t === 'matchJoined');

    // Wait for at least one snapshot so the session is clearly started.
    await onceMessage(home, (m) => m.t === 'matchSnapshot', 5000);

    const spectator = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const snapOrSpectating = onceMessage(
      spectator,
      (m) => m.t === 'matchSpectating' || m.t === 'matchSnapshot',
      5000,
    );
    spectator.send(
      JSON.stringify({
        t: 'join',
        roomId: 'late-spec',
        token: 'test:late-spec',
        role: 'spectator',
      }),
    );
    await onceMessage(spectator, (m) => m.t === 'joined' && m.role === 'spectator');
    await snapOrSpectating;

    home.close();
    away.close();
    spectator.close();
  });

  it('different rooms are isolated', async () => {
    const a = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    const b = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    a.send(JSON.stringify({ t: 'join', roomId: 'iso-1', token: 'test-token-abc' }));
    b.send(JSON.stringify({ t: 'join', roomId: 'iso-2', token: 'test-token-abc' }));
    await onceMessage(a, (m) => m.t === 'joined');
    await onceMessage(b, (m) => m.t === 'joined');

    let leaked = false;
    b.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'probeState' && m.seq === 99) leaked = true;
    });
    a.send(JSON.stringify({ t: 'probeInput', seq: 99, x: 0.5, y: -1 }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(leaked, false);
    assert.equal(ctx.game.rooms.roomCount(), 2);
    a.close();
    b.close();
  });

  it('disconnect cleans and empty room removed', async () => {
    const a = await connect(ctx.wsUrl, { origin: 'http://localhost:4321' });
    a.send(JSON.stringify({ t: 'join', roomId: 'tmp', token: 'test-token-abc' }));
    await onceMessage(a, (m) => m.t === 'joined');
    assert.equal(ctx.game.rooms.roomCount(), 1);
    const closed = new Promise((r) => a.once('close', r));
    a.close();
    await closed;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(ctx.game.rooms.roomCount(), 0);
  });

  it('SIGTERM closes cleanly', async () => {
    const health = await fetch(`${ctx.base}/health`);
    assert.equal(health.status, 200);
    await ctx.game.close();
    await assert.rejects(() => fetch(`${ctx.base}/health`), /fetch failed|ECONNREFUSED/);
    // recreate for afterEach close
    ctx = await startProbe();
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createTestAuthVerifier } from '../src/auth.js';
import { createGameServer } from '../src/server.js';
import { createGameSimMatchHost } from '../src/matchHost.js';
import { createMatch } from '../../../packages/game-sim/src/index.ts';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function connect(wsUrl, { origin = 'http://localhost:4321', timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function onceMessage(ws, predicate, timeoutMs = 5000) {
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

describe('game-sim match host', () => {
  /** @type {Awaited<ReturnType<typeof start>>} */
  let ctx;
  /** @type {object[]} */
  let persisted;

  async function start() {
    const port = await freePort();
    persisted = [];
    const config = loadConfig({
      NODE_ENV: 'development',
      PORT: String(port),
      WS_AUTH_MODE: 'test',
      WS_TEST_TOKEN: 'unused',
      ALLOWED_ORIGINS: 'http://localhost:4321',
      INSFORGE_BASE_URL: 'https://example.insforge.app',
      PUBLIC_APP_ORIGIN: 'http://localhost:4321',
      LOG_LEVEL: 'error',
      MATCH_TICK_HZ: '20',
      MATCH_SNAPSHOT_HZ: '20',
    });
    const log = createLogger('error');
    const game = await createGameServer({
      config,
      log,
      authVerifier: createTestAuthVerifier('unused'),
      matchHost: createGameSimMatchHost(createMatch),
      persistResult: async (result) => {
        persisted.push(result);
        return { ok: true, matchId: 'test-match' };
      },
    });
    await game.listen({ port });
    return { game, port, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
  }

  beforeEach(async () => {
    ctx = await start();
  });

  afterEach(async () => {
    await ctx.game.close();
  });

  it('starts 11v11 with two humans and emits pose-rich snapshots', async () => {
    const a = await connect(ctx.wsUrl);
    const b = await connect(ctx.wsUrl);

    a.send(JSON.stringify({ t: 'join', roomId: 'sim-1', token: 'test:home-user' }));
    await onceMessage(a, (m) => m.t === 'joined');
    b.send(JSON.stringify({ t: 'join', roomId: 'sim-1', token: 'test:away-user' }));
    await onceMessage(b, (m) => m.t === 'joined');

    a.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'home',
        homeTeamId: 'team-home',
        awayTeamId: 'team-away',
        durationSeconds: 900,
      }),
    );
    await onceMessage(a, (m) => m.t === 'matchJoined');
    b.send(JSON.stringify({ t: 'matchJoin', side: 'away' }));
    await onceMessage(b, (m) => m.t === 'matchJoined');

    const snap = await onceMessage(
      a,
      (m) => m.t === 'matchSnapshot' && Array.isArray(m.players) && m.players.length >= 22,
      4000,
    );
    assert.equal(snap.stub, false);
    assert.ok(snap.ball);
    assert.equal(typeof snap.ball.x, 'number');
    assert.equal(snap.score.home, 0);
    assert.equal(snap.players.length, 22);

    a.send(JSON.stringify({ t: 'probeInput', seq: 1, x: 1, y: 0 }));
    await onceMessage(a, (m) => m.t === 'probeState' && m.seq === 1);

    a.close();
    b.close();
  });

  it('keeps match session during empty-room grace and rebinds on rejoin', async () => {
    const a = await connect(ctx.wsUrl);
    const b = await connect(ctx.wsUrl);
    a.send(JSON.stringify({ t: 'join', roomId: 'sim-grace', token: 'test:grace-home' }));
    await onceMessage(a, (m) => m.t === 'joined');
    b.send(JSON.stringify({ t: 'join', roomId: 'sim-grace', token: 'test:grace-away' }));
    await onceMessage(b, (m) => m.t === 'joined');

    a.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'home',
        humans: [
          { userId: 'grace-home', side: 'home', fieldSlot: 0 },
          { userId: 'grace-away', side: 'away', fieldSlot: 0 },
        ],
        durationSeconds: 900,
      }),
    );
    await onceMessage(a, (m) => m.t === 'matchJoined');
    b.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'away',
        humans: [
          { userId: 'grace-home', side: 'home', fieldSlot: 0 },
          { userId: 'grace-away', side: 'away', fieldSlot: 0 },
        ],
      }),
    );
    await onceMessage(b, (m) => m.t === 'matchJoined');
    await onceMessage(a, (m) => m.t === 'matchSnapshot' && Array.isArray(m.players), 4000);

    const closedA = new Promise((r) => a.once('close', r));
    const closedB = new Promise((r) => b.once('close', r));
    a.close();
    b.close();
    await closedA;
    await closedB;
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(ctx.game.rooms.roomCount(), 0);
    assert.ok(ctx.game.matchSessions.has('sim-grace'), 'match session survives empty WS room');

    const rejoin = await connect(ctx.wsUrl);
    rejoin.send(JSON.stringify({ t: 'join', roomId: 'sim-grace', token: 'test:grace-home' }));
    await onceMessage(rejoin, (m) => m.t === 'joined');
    // Live match should push a snapshot on join even before matchJoin.
    await onceMessage(rejoin, (m) => m.t === 'matchSnapshot', 4000);
    rejoin.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'home',
        fieldSlot: 0,
        humans: [
          { userId: 'grace-home', side: 'home', fieldSlot: 0 },
          { userId: 'grace-away', side: 'away', fieldSlot: 0 },
        ],
      }),
    );
    await onceMessage(rejoin, (m) => m.t === 'matchJoined');
    assert.ok(ctx.game.matchSessions.get('sim-grace')?.started);
    rejoin.close();
  });

  it('compacts wire snapshot floats', async () => {
    const host = createGameSimMatchHost(createMatch);
    host.start(
      'wire-compact',
      [{ userId: 'u1', side: 'home', fieldSlot: 0 }],
      { durationSeconds: 900 },
    );
    host.tick(50);
    const snap = host.snapshot('wire-compact');
    assert.ok(snap);
    assert.equal(snap.ball.x, Math.round(snap.ball.x * 10) / 10);
    assert.equal(snap.ball.vx, Math.round(snap.ball.vx));
    for (const p of snap.players) {
      assert.equal(p.x, Math.round(p.x * 10) / 10);
      assert.equal(p.vx, Math.round(p.vx));
    }
    host.stop('wire-compact');
  });

  it('persists when short match finishes', async () => {
    const a = await connect(ctx.wsUrl);
    const b = await connect(ctx.wsUrl);
    a.send(JSON.stringify({ t: 'join', roomId: 'sim-end', token: 'test:h2' }));
    await onceMessage(a, (m) => m.t === 'joined');
    b.send(JSON.stringify({ t: 'join', roomId: 'sim-end', token: 'test:a2' }));
    await onceMessage(b, (m) => m.t === 'joined');

    a.send(
      JSON.stringify({
        t: 'matchJoin',
        side: 'home',
        homeTeamId: 'th',
        awayTeamId: 'ta',
        durationSeconds: 1,
      }),
    );
    await onceMessage(a, (m) => m.t === 'matchJoined');
    b.send(JSON.stringify({ t: 'matchJoin', side: 'away', durationSeconds: 1 }));
    await onceMessage(b, (m) => m.t === 'matchJoined');

    const finished = await onceMessage(a, (m) => m.t === 'finished', 8000);
    assert.equal(typeof finished.homeScore, 'number');
    assert.equal(typeof finished.awayScore, 'number');

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(persisted.length >= 1);
    assert.equal(persisted[0].homeTeamId, 'th');
    assert.equal(persisted[0].awayTeamId, 'ta');

    a.close();
    b.close();
  });
});

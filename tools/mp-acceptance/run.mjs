#!/usr/bin/env node
/**
 * Multiplayer WS acceptance CLI.
 * Targets GAME_SERVER_URL / PUBLIC_GAME_SERVER_URL, or starts a local game-server.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, onceMessage, closeAll, closeQuiet } from '../../tests/multiplayer/helpers/wsClient.mjs';
import {
  startLocalServer,
  waitForHealth,
  DEFAULT_ORIGIN,
  DEFAULT_TEST_TOKEN,
} from '../../tests/multiplayer/helpers/startLocalServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function httpToWs(url) {
  const u = new URL(url);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = u.pathname.replace(/\/$/, '') || '';
  return u.toString().replace(/\/$/, '');
}

function resolveTarget() {
  const raw =
    process.env.GAME_SERVER_URL ||
    process.env.PUBLIC_GAME_SERVER_URL ||
    process.env.MP_ACCEPTANCE_URL ||
    '';
  if (raw.trim()) {
    const base = raw.replace(/\/$/, '');
    return { mode: 'remote', base, wsUrl: httpToWs(base), started: false };
  }
  return { mode: 'local', base: null, wsUrl: null, started: true };
}

function pass(name) {
  console.log(`  PASS  ${name}`);
  return { name, ok: true };
}

function fail(name, err) {
  const msg = err?.message || String(err);
  console.log(`  FAIL  ${name}: ${msg}`);
  return { name, ok: false, error: msg };
}

async function scenario(name, fn) {
  try {
    await fn();
    return pass(name);
  } catch (err) {
    return fail(name, err);
  } finally {
    await closeAll();
  }
}

async function main() {
  const token = process.env.WS_TEST_TOKEN || DEFAULT_TEST_TOKEN;
  const origin = process.env.MP_ORIGIN || DEFAULT_ORIGIN;
  let target = resolveTarget();
  /** @type {Awaited<ReturnType<typeof startLocalServer>> | null} */
  let local = null;

  console.log('mp-acceptance');
  console.log(`  mode: ${target.mode}`);

  try {
    if (target.mode === 'local') {
      local = await startLocalServer({
        env: {
          WS_TEST_TOKEN: token,
          ALLOWED_ORIGINS: origin,
          PUBLIC_APP_ORIGIN: origin,
        },
      });
      target = { mode: 'local', base: local.base, wsUrl: local.wsUrl, started: true };
      console.log(`  server: ${local.base} (spawned)`);
    } else {
      console.log(`  server: ${target.base}`);
      await waitForHealth(target.base, { timeoutMs: 10000 });
    }

    const { base, wsUrl } = target;
    const results = [];

    results.push(
      await scenario('health', async () => {
        const res = await fetch(`${base}/health`);
        if (res.status !== 200) throw new Error(`status ${res.status}`);
        const body = await res.json();
        if (!body.ok || body.service !== 'golazo-game-server') {
          throw new Error(`unexpected body ${JSON.stringify(body)}`);
        }
      }),
    );

    results.push(
      await scenario('two clients join + probeState', async () => {
        const roomId = `cli-two-${Date.now()}`;
        const a = await connect(wsUrl, { origin });
        const b = await connect(wsUrl, { origin });
        a.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(a, (m) => m.t === 'joined');
        const peerOnA = onceMessage(a, (m) => m.t === 'peerJoined');
        const peerOnB = onceMessage(b, (m) => m.t === 'peerJoined');
        b.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(b, (m) => m.t === 'joined');
        await peerOnA;
        await peerOnB;
        const stateOnB = onceMessage(b, (m) => m.t === 'probeState' && m.seq === 1);
        a.send(JSON.stringify({ t: 'probeInput', seq: 1, x: 0.25, y: -0.5 }));
        const state = await stateOnB;
        if (state.clients !== 2) throw new Error(`clients=${state.clients}`);
        await closeQuiet(a);
        await closeQuiet(b);
      }),
    );

    results.push(
      await scenario('third reject ROOM_FULL', async () => {
        const roomId = `cli-full-${Date.now()}`;
        const a = await connect(wsUrl, { origin });
        const b = await connect(wsUrl, { origin });
        const c = await connect(wsUrl, { origin });
        a.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(a, (m) => m.t === 'joined');
        const peerP = onceMessage(a, (m) => m.t === 'peerJoined');
        b.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(b, (m) => m.t === 'joined');
        await peerP;
        const errP = onceMessage(c, (m) => m.t === 'error' && m.code === 'ROOM_FULL');
        c.send(JSON.stringify({ t: 'join', roomId, token }));
        await errP;
        await closeQuiet(a);
        await closeQuiet(b);
        await closeQuiet(c);
      }),
    );

    results.push(
      await scenario('bad token UNAUTHORIZED', async () => {
        const ws = await connect(wsUrl, { origin });
        const errP = onceMessage(ws, (m) => m.t === 'error');
        ws.send(JSON.stringify({ t: 'join', roomId: 'cli-bad', token: 'wrong-token' }));
        const err = await errP;
        if (err.code !== 'UNAUTHORIZED') throw new Error(`code=${err.code}`);
        await closeQuiet(ws);
      }),
    );

    results.push(
      await scenario('bad origin 403', async () => {
        try {
          await connect(wsUrl, { origin: 'https://evil.example' });
          throw new Error('expected upgrade rejection');
        } catch (err) {
          if (err.statusCode === 403 || /403/.test(String(err))) return;
          throw err;
        }
      }),
    );

    results.push(
      await scenario('ping/pong', async () => {
        const ws = await connect(wsUrl, { origin });
        ws.send(JSON.stringify({ t: 'join', roomId: `cli-ping-${Date.now()}`, token }));
        await onceMessage(ws, (m) => m.t === 'joined');
        const pongP = onceMessage(ws, (m) => m.t === 'pong');
        ws.send(JSON.stringify({ t: 'ping', clientTime: 42 }));
        const pong = await pongP;
        if (pong.clientTime !== 42 || typeof pong.serverTime !== 'number') {
          throw new Error('bad pong');
        }
        await closeQuiet(ws);
      }),
    );

    results.push(
      await scenario('room isolation', async () => {
        const a = await connect(wsUrl, { origin });
        const b = await connect(wsUrl, { origin });
        a.send(JSON.stringify({ t: 'join', roomId: `cli-iso-a-${Date.now()}`, token }));
        b.send(JSON.stringify({ t: 'join', roomId: `cli-iso-b-${Date.now()}`, token }));
        await onceMessage(a, (m) => m.t === 'joined');
        await onceMessage(b, (m) => m.t === 'joined');
        let leaked = false;
        b.on('message', (raw) => {
          try {
            const m = JSON.parse(String(raw));
            if (m.t === 'probeState' && m.seq === 77) leaked = true;
          } catch {
            /* ignore */
          }
        });
        a.send(JSON.stringify({ t: 'probeInput', seq: 77, x: 1, y: 0 }));
        await new Promise((r) => setTimeout(r, 120));
        if (leaked) throw new Error('probeState leaked across rooms');
        await closeQuiet(a);
        await closeQuiet(b);
      }),
    );

    results.push(
      await scenario('cleanup empties room', async () => {
        const roomId = `cli-clean-${Date.now()}`;
        const health0 = await (await fetch(`${base}/health`)).json();
        const roomsBefore = health0.rooms;
        const a = await connect(wsUrl, { origin });
        const b = await connect(wsUrl, { origin });
        a.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(a, (m) => m.t === 'joined');
        b.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(b, (m) => m.t === 'joined');
        await closeQuiet(a);
        await closeQuiet(b);
        await new Promise((r) => setTimeout(r, 80));
        const health2 = await (await fetch(`${base}/health`)).json();
        if (health2.rooms !== roomsBefore) {
          throw new Error(`rooms ${health2.rooms} != before ${roomsBefore}`);
        }
        const c = await connect(wsUrl, { origin });
        c.send(JSON.stringify({ t: 'join', roomId, token }));
        await onceMessage(c, (m) => m.t === 'joined');
        await closeQuiet(c);
      }),
    );

    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`summary: ${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
      for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (err) {
    console.error('mp-acceptance fatal:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await closeAll();
    if (local) await local.stop();
  }
}

await main();
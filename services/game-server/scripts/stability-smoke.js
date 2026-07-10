/**
 * Local stability smoke (~2–3 min). 10-min soak is deferred until Railway deploy.
 *
 * Usage:
 *   node scripts/stability-smoke.js
 *   DURATION_MS=180000 node scripts/stability-smoke.js
 */
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createGameServer } from '../src/server.js';
import { createTestAuthVerifier } from '../src/auth.js';
import { createStubMatchHost } from '../src/matchHost.js';

const DURATION_MS = Number(process.env.DURATION_MS || 150_000);
const PORT = Number(process.env.PORT || 8799);

const config = loadConfig({
  NODE_ENV: 'development',
  PORT: String(PORT),
  WS_AUTH_MODE: 'test',
  WS_TEST_TOKEN: 'smoke-token',
  ALLOWED_ORIGINS: 'http://localhost:4321',
  INSFORGE_BASE_URL: 'https://example.insforge.app',
  PUBLIC_APP_ORIGIN: 'http://localhost:4321',
  LOG_LEVEL: 'info',
});

const log = createLogger('info');
const game = await createGameServer({
  config,
  log,
  authVerifier: createTestAuthVerifier(config.testToken),
  matchHost: createStubMatchHost(),
});
await game.listen({ port: PORT });

const memSamples = [];
const clients = [];

function openClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'http://localhost:4321' });
    ws.once('open', () => {
      ws.send(JSON.stringify({ t: 'join', roomId: 'smoke-room', token: 'smoke-token' }));
      resolve(ws);
    });
    ws.once('error', reject);
    clients.push({ name, ws });
  });
}

const a = await openClient('a');
const b = await openClient('b');
await new Promise((r) => setTimeout(r, 200));

const started = Date.now();
let pings = 0;
let reconnects = 0;

const pingTimer = setInterval(() => {
  const t = Date.now();
  for (const { ws } of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'ping', clientTime: t }));
      ws.send(JSON.stringify({ t: 'probeInput', seq: pings, x: Math.sin(pings / 10), y: -1 }));
      pings += 1;
    }
  }
  memSamples.push(process.memoryUsage().heapUsed);
}, 1000);

setTimeout(async () => {
  // disconnect/reconnect one client mid-run
  b.close();
  reconnects += 1;
  await new Promise((r) => setTimeout(r, 500));
  const b2 = await openClient('b2');
  clients[1] = { name: 'b2', ws: b2 };
}, Math.floor(DURATION_MS / 2));

await new Promise((r) => setTimeout(r, DURATION_MS));
clearInterval(pingTimer);

const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());
for (const { ws } of clients) {
  try {
    ws.close();
  } catch {
    // ignore
  }
}
await new Promise((r) => setTimeout(r, 200));
const healthAfter = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());

await game.close();

const first = memSamples[0] ?? 0;
const last = memSamples[memSamples.length - 1] ?? 0;
const max = Math.max(...memSamples, 0);
const approxMb = (n) => Math.round((n / 1024 / 1024) * 10) / 10;

const report = {
  durationMs: Date.now() - started,
  pings,
  reconnects,
  roomsAfterClose: healthAfter.rooms,
  connectionsAfterClose: healthAfter.connections,
  heapFirstMb: approxMb(first),
  heapLastMb: approxMb(last),
  heapMaxMb: approxMb(max),
  healthOk: health.ok === true,
  emptyRoomsGone: healthAfter.rooms === 0,
};

console.log(JSON.stringify(report, null, 2));
if (!report.healthOk || !report.emptyRoomsGone) process.exit(1);

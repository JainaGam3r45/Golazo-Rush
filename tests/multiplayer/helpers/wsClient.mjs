import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function resolveWs() {
  const candidates = [
    path.join(repoRoot, 'services/game-server/node_modules/ws/package.json'),
    path.join(repoRoot, 'tools/compute-probe/node_modules/ws/package.json'),
  ];
  for (const pkgJson of candidates) {
    if (existsSync(pkgJson)) {
      return createRequire(pkgJson)('ws');
    }
  }
  throw new Error(
    'ws package not found under services/game-server or tools/compute-probe node_modules',
  );
}

const WebSocket = resolveWs();

const tracked = new Set();

/**
 * @param {string} wsUrl
 * @param {{ origin?: string, timeoutMs?: number }} [opts]
 */
export function connect(wsUrl, { origin, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, origin ? { origin } : undefined);
    tracked.add(ws);
    const timer = setTimeout(() => {
      ws.terminate();
      tracked.delete(ws);
      reject(new Error('connect timeout'));
    }, timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      tracked.delete(ws);
      const err = new Error(`unexpected ${res.statusCode}`);
      err.statusCode = res.statusCode;
      reject(err);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      tracked.delete(ws);
      reject(err);
    });
    ws.once('close', () => {
      tracked.delete(ws);
    });
  });
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {(msg: any) => boolean} [predicate]
 * @param {number} [timeoutMs]
 */
export function onceMessage(ws, predicate, timeoutMs = 5000) {
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

export async function closeQuiet(ws) {
  if (!ws) return;
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    tracked.delete(ws);
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      resolve();
    }, 2000);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      ws.close();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
  tracked.delete(ws);
}

export async function closeAll() {
  const sockets = [...tracked];
  tracked.clear();
  await Promise.all(sockets.map((ws) => closeQuiet(ws)));
}

export { WebSocket, repoRoot };
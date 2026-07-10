import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './wsClient.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_TEST_TOKEN = 'mp-acceptance-token';
export const DEFAULT_ORIGIN = 'http://localhost:4321';

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * @param {string} baseUrl
 * @param {{ timeoutMs?: number, intervalMs?: number }} [opts]
 */
export async function waitForHealth(baseUrl, { timeoutMs = 20000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) {
        const body = await res.json();
        if (body?.ok) return body;
      }
      lastErr = new Error(`health status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`health timeout: ${lastErr?.message || lastErr}`);
}

/**
 * Spawn game-server as a subprocess (does not import server source).
 * @param {{ port?: number, env?: Record<string, string> }} [opts]
 */
export async function startLocalServer({ port, env = {} } = {}) {
  const listenPort = port ?? (await freePort());
  const cwd = path.join(repoRoot, 'services/game-server');
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WS_AUTH_MODE: 'test',
      WS_TEST_TOKEN: DEFAULT_TEST_TOKEN,
      ALLOWED_ORIGINS: DEFAULT_ORIGIN,
      PUBLIC_APP_ORIGIN: DEFAULT_ORIGIN,
      INSFORGE_BASE_URL: 'https://b963cy5n.us-east.insforge.app',
      LOG_LEVEL: 'error',
      PORT: String(listenPort),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  child.stderr?.on('data', (buf) => {
    stderr += String(buf);
  });
  child.stdout?.on('data', () => {});

  const base = `http://127.0.0.1:${listenPort}`;
  const wsUrl = `ws://127.0.0.1:${listenPort}`;

  const earlyExit = new Promise((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(
        new Error(
          `game-server exited early code=${code} signal=${signal} stderr=${stderr.slice(-800)}`,
        ),
      );
    });
    child.once('error', reject);
  });

  try {
    await Promise.race([waitForHealth(base), earlyExit]);
  } catch (err) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    throw err;
  }

  return {
    port: listenPort,
    base,
    wsUrl,
    token: env.WS_TEST_TOKEN || DEFAULT_TEST_TOKEN,
    origin: (env.ALLOWED_ORIGINS || DEFAULT_ORIGIN).split(',')[0].trim(),
    child,
    async stop() {
      if (child.exitCode != null || child.signalCode != null) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 4000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          child.kill('SIGTERM');
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    },
  };
}

export { repoRoot, __dirname };
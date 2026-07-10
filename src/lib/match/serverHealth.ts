import { getPublicGameServerUrl, toHttpUrl } from './onlineProtocol.ts';

export type ServerHealthStatus = 'online' | 'connecting' | 'degraded' | 'offline' | 'unknown';

export type ServerHealthSnapshot = {
  status: ServerHealthStatus;
  checkedAt: number;
  detail?: string;
};

export type ServerHealthHandle = {
  getSnapshot(): ServerHealthSnapshot;
  start(): void;
  stop(): void;
  dispose(): void;
};

const DEFAULT_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

export function healthUrlFromGameServer(base: string | null): string | null {
  if (!base) return null;
  return `${toHttpUrl(base)}/health`;
}

async function probeHealth(url: string): Promise<ServerHealthSnapshot> {
  const checkedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (res.ok) {
      return { status: 'online', checkedAt };
    }
    if (res.status >= 500) {
      return { status: 'degraded', checkedAt, detail: `HTTP ${res.status}` };
    }
    return { status: 'degraded', checkedAt, detail: `HTTP ${res.status}` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unreachable';
    return { status: 'offline', checkedAt, detail };
  } finally {
    clearTimeout(timer);
  }
}

export function createServerHealthMonitor(options?: {
  intervalMs?: number;
  onChange?: (snap: ServerHealthSnapshot) => void;
}): ServerHealthHandle {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  let snapshot: ServerHealthSnapshot = { status: 'unknown', checkedAt: 0 };
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let inFlight = false;

  async function tick() {
    if (disposed || inFlight) return;
    const url = healthUrlFromGameServer(getPublicGameServerUrl());
    if (!url) {
      snapshot = { status: 'offline', checkedAt: Date.now(), detail: 'PUBLIC_GAME_SERVER_URL no configurada' };
      options?.onChange?.(snapshot);
      return;
    }
    if (snapshot.status === 'unknown' || snapshot.status === 'offline') {
      snapshot = { ...snapshot, status: 'connecting' };
      options?.onChange?.(snapshot);
    }
    inFlight = true;
    try {
      snapshot = await probeHealth(url);
      if (!disposed) options?.onChange?.(snapshot);
    } finally {
      inFlight = false;
    }
  }

  return {
    getSnapshot() {
      return snapshot;
    },
    start() {
      if (disposed || timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    dispose() {
      disposed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

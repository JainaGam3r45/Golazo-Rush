import type { OnlineEntityPose, OnlineMatchSnap, OnlinePlayerSnap } from './onlineProtocol.ts';

export type Vec2 = { x: number; y: number };

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

export function lerpPose(a: OnlineEntityPose, b: OnlineEntityPose, t: number): OnlineEntityPose {
  const u = clamp01(t);
  return {
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u),
    vx: lerp(a.vx, b.vx, u),
    vy: lerp(a.vy, b.vy, u),
  };
}

export function extrapolatePose(pose: OnlineEntityPose, dtMs: number): OnlineEntityPose {
  const dt = dtMs / 1000;
  return {
    x: pose.x + pose.vx * dt,
    y: pose.y + pose.vy * dt,
    vx: pose.vx,
    vy: pose.vy,
  };
}

export type SnapBuffer = {
  prev: OnlineMatchSnap | null;
  next: OnlineMatchSnap | null;
};

export function pushSnap(buffer: SnapBuffer, snap: OnlineMatchSnap): SnapBuffer {
  if (!buffer.next) {
    return { prev: snap, next: snap };
  }
  return { prev: buffer.next, next: snap };
}

function indexPlayers(players: OnlinePlayerSnap[]): Map<string, OnlinePlayerSnap> {
  const map = new Map<string, OnlinePlayerSnap>();
  for (const p of players) {
    map.set(p.id, p);
    map.set(`${p.side}:${p.slot}`, p);
  }
  return map;
}

export type InterpolatedFrame = {
  ball: OnlineEntityPose;
  players: Map<string, OnlineEntityPose & { meta: OnlinePlayerSnap }>;
  score: { home: number; away: number };
  phase: string;
  clockMs: number;
  durationSeconds: number;
  half: 1 | 2;
  tick: number;
  alpha: number;
};

/**
 * Render time is slightly behind the latest snap so we can interpolate.
 * Default render delay: 100ms.
 */
export function sampleInterpolatedFrame(
  buffer: SnapBuffer,
  nowMs: number,
  renderDelayMs = 100,
): InterpolatedFrame | null {
  const { prev, next } = buffer;
  if (!next) return null;

  const renderAt = nowMs - renderDelayMs;

  if (!prev || prev === next || prev.receivedAt >= next.receivedAt) {
    return frameFromSnap(next, 1);
  }

  const span = Math.max(1, next.receivedAt - prev.receivedAt);
  const alpha = clamp01((renderAt - prev.receivedAt) / span);

  if (alpha <= 0) return frameFromSnap(prev, 0);
  if (alpha >= 1) {
    // Mild extrapolation past the latest snap (cap 50ms).
    const overshoot = Math.min(50, renderAt - next.receivedAt);
    if (overshoot <= 0) return frameFromSnap(next, 1);
    return frameFromSnap(next, 1, overshoot);
  }

  const prevMap = indexPlayers(prev.players);
  const nextMap = indexPlayers(next.players);
  const players = new Map<string, OnlineEntityPose & { meta: OnlinePlayerSnap }>();

  for (const [key, np] of nextMap) {
    if (!key.includes(':') && next.players.some((p) => p.id === key)) {
      const pp = prevMap.get(key) ?? prevMap.get(`${np.side}:${np.slot}`);
      const pose = pp ? lerpPose(pp, np, alpha) : { x: np.x, y: np.y, vx: np.vx, vy: np.vy };
      players.set(np.id, { ...pose, meta: np });
    }
  }

  // Ensure every next player is present even if id indexing skipped duplicates.
  for (const np of next.players) {
    if (players.has(np.id)) continue;
    const pp = prevMap.get(np.id) ?? prevMap.get(`${np.side}:${np.slot}`);
    const pose = pp ? lerpPose(pp, np, alpha) : { x: np.x, y: np.y, vx: np.vx, vy: np.vy };
    players.set(np.id, { ...pose, meta: np });
  }

  return {
    ball: lerpPose(prev.ball, next.ball, alpha),
    players,
    score: next.score,
    phase: next.phase,
    clockMs: Math.round(lerp(prev.clockMs, next.clockMs, alpha)),
    durationSeconds: next.durationSeconds,
    half: next.half,
    tick: next.tick,
    alpha,
  };
}

function frameFromSnap(
  snap: OnlineMatchSnap,
  alpha: number,
  extrapolateMs = 0,
): InterpolatedFrame {
  const players = new Map<string, OnlineEntityPose & { meta: OnlinePlayerSnap }>();
  for (const p of snap.players) {
    const pose =
      extrapolateMs > 0
        ? extrapolatePose(p, extrapolateMs)
        : { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    players.set(p.id, { ...pose, meta: p });
  }
  const ball =
    extrapolateMs > 0 ? extrapolatePose(snap.ball, extrapolateMs) : { ...snap.ball };
  return {
    ball,
    players,
    score: snap.score,
    phase: snap.phase,
    clockMs: snap.clockMs,
    durationSeconds: snap.durationSeconds,
    half: snap.half,
    tick: snap.tick,
    alpha,
  };
}

/** Soft reconcile local predicted position toward authoritative snap. */
export function softCorrect(
  local: Vec2,
  auth: Vec2,
  factor = 0.2,
  snapDistance = 48,
): Vec2 {
  const dx = auth.x - local.x;
  const dy = auth.y - local.y;
  const dist = Math.hypot(dx, dy);
  if (dist > snapDistance) {
    return { x: auth.x, y: auth.y };
  }
  return {
    x: local.x + dx * factor,
    y: local.y + dy * factor,
  };
}

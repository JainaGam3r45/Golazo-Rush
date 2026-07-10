/** Flexible WS protocol aligned with services/game-server (+ future snap shapes). */

export type OnlineConnStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'joined'
  | 'playing'
  | 'reconnecting'
  | 'closed'
  | 'error';

export type OnlineInputButtons = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  shoot: boolean;
  pass: boolean;
  tackle: boolean;
  clear: boolean;
};

export type OnlineEntityPose = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type OnlinePlayerSnap = OnlineEntityPose & {
  id: string;
  side: 'home' | 'away';
  slot: number;
  kind: 'human' | 'bot' | 'gk';
  userId: string | null;
};

export type OnlineScore = {
  home: number;
  away: number;
};

export type OnlineMatchSnap = {
  tick: number;
  phase: string;
  clockMs: number;
  score: OnlineScore;
  ball: OnlineEntityPose;
  players: OnlinePlayerSnap[];
  events: unknown[];
  receivedAt: number;
  /** True when server sent stub state without poses (probe / pre-sim). */
  stub?: boolean;
};

export type ClientJoinMsg = {
  t: 'join';
  roomId: string;
  token: string;
  matchSessionToken?: string;
  formatId?: '5v5';
};

export type ClientPingMsg = {
  t: 'ping';
  clientTime: number;
};

/** Current game-server probe input: axis in [-1, 1] plus action buttons. */
export type ClientProbeInputMsg = {
  t: 'probeInput';
  seq: number;
  x: number;
  y: number;
  buttons?: OnlineInputButtons;
  sprint?: boolean;
  shoot?: boolean;
  pass?: boolean;
  clear?: boolean;
  tackle?: boolean;
};

export type ClientMatchJoinMsg = {
  t: 'matchJoin';
  side: 'home' | 'away';
  durationSeconds?: number;
  homeFormationId?: string;
  awayFormationId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeLineup?: Array<{ nx: number; ny: number; role?: string }>;
  awayLineup?: Array<{ nx: number; ny: number; role?: string }>;
};

/** Future button-based input when server supports it. */
export type ClientMatchInputMsg = {
  t: 'matchInput' | 'input';
  seq: number;
  buttons: OnlineInputButtons;
  aim?: number;
  x?: number;
  y?: number;
};

export type ClientOutboundMsg =
  | ClientJoinMsg
  | ClientPingMsg
  | ClientProbeInputMsg
  | ClientMatchJoinMsg
  | ClientMatchInputMsg;

export type ServerInboundMsg = { t: string; [k: string]: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sideOf(value: unknown): 'home' | 'away' {
  return value === 'away' ? 'away' : 'home';
}

function kindOf(value: unknown, slot: number): OnlinePlayerSnap['kind'] {
  if (value === 'gk' || value === 'goalkeeper' || slot < 0) return 'gk';
  if (value === 'human' || value === 'player') return 'human';
  return 'bot';
}

export function emptyButtons(): OnlineInputButtons {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false,
    shoot: false,
    pass: false,
    tackle: false,
    clear: false,
  };
}

/** Map WASD buttons to probe axis in [-1, 1]. */
export function buttonsToAxis(buttons: OnlineInputButtons): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (buttons.left) x -= 1;
  if (buttons.right) x += 1;
  if (buttons.up) y -= 1;
  if (buttons.down) y += 1;
  if (x !== 0 || y !== 0) {
    const len = Math.hypot(x, y) || 1;
    x /= len;
    y /= len;
  }
  return { x, y };
}

export function parseServerMessage(raw: unknown): ServerInboundMsg | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const obj = asRecord(value);
  if (!obj) return null;
  const t = obj.t ?? obj.type ?? obj.op;
  if (typeof t !== 'string' || !t) return null;
  return { ...obj, t };
}

export function parsePose(raw: unknown, fallback?: Partial<OnlineEntityPose>): OnlineEntityPose {
  const obj = asRecord(raw) ?? {};
  const pos = asRecord(obj.pos) ?? asRecord(obj.p);
  return {
    x: num(obj.x ?? pos?.x ?? fallback?.x, 0),
    y: num(obj.y ?? pos?.y ?? fallback?.y, 0),
    vx: num(obj.vx ?? obj.velX ?? pos?.vx ?? fallback?.vx, 0),
    vy: num(obj.vy ?? obj.velY ?? pos?.vy ?? fallback?.vy, 0),
  };
}

export function parseScore(raw: unknown): OnlineScore {
  if (Array.isArray(raw) && raw.length >= 2) {
    return { home: num(raw[0]), away: num(raw[1]) };
  }
  const obj = asRecord(raw) ?? {};
  return {
    home: num(obj.home ?? obj.h ?? obj.homeScore),
    away: num(obj.away ?? obj.a ?? obj.awayScore),
  };
}

export function parsePlayerSnap(raw: unknown, index: number): OnlinePlayerSnap | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const slot = num(obj.slot ?? obj.s ?? index, index);
  const pose = parsePose(obj);
  const id =
    typeof obj.id === 'string'
      ? obj.id
      : typeof obj.playerId === 'string'
        ? obj.playerId
        : typeof obj.userId === 'string'
          ? obj.userId
          : `${sideOf(obj.side ?? obj.team)}:${slot}`;
  return {
    id,
    side: sideOf(obj.side ?? obj.team),
    slot,
    kind: kindOf(obj.kind ?? obj.role ?? obj.type, slot),
    userId:
      typeof obj.userId === 'string'
        ? obj.userId
        : typeof obj.uid === 'string'
          ? obj.uid
          : null,
    ...pose,
  };
}

/**
 * Accepts `snap` / `snapshot` / `state` / `matchSnapshot`.
 * Stub matchSnapshot `{ tick, serverTime, state: { stub: true } }` yields an empty pose frame.
 */
export function parseMatchSnap(msg: ServerInboundMsg, receivedAt = Date.now()): OnlineMatchSnap | null {
  const t = msg.t;
  if (t !== 'snap' && t !== 'snapshot' && t !== 'state' && t !== 'matchSnapshot') {
    return null;
  }

  const payload = asRecord(msg.payload) ?? asRecord(msg.data) ?? asRecord(msg.state) ?? msg;
  const stubFlag = Boolean(payload.stub ?? asRecord(msg.state)?.stub);

  const playersRaw = payload.players ?? payload.p ?? payload.entities;
  const players: OnlinePlayerSnap[] = [];
  if (Array.isArray(playersRaw)) {
    for (let i = 0; i < playersRaw.length; i++) {
      const row = playersRaw[i];
      // Stub host lists `{ userId, side }` without poses — skip until sim ships.
      const rec = asRecord(row);
      if (rec && rec.x === undefined && rec.y === undefined && rec.pos === undefined) {
        continue;
      }
      const p = parsePlayerSnap(row, i);
      if (p) players.push(p);
    }
  }

  const clockSeconds = num(payload.clockSeconds, NaN);
  const clockMs = Number.isFinite(clockSeconds)
    ? Math.round(clockSeconds * 1000)
    : num(payload.clockMs ?? payload.clock ?? payload.timeLeftMs ?? payload.remainingMs, 0);

  const hasBall = payload.ball != null || payload.b != null;
  const isStub = stubFlag || (!hasBall && players.length === 0);

  return {
    tick: num(payload.tick ?? msg.tick ?? payload.frame ?? payload.n, 0),
    phase: typeof payload.phase === 'string' ? payload.phase : isStub ? 'waiting' : 'playing',
    clockMs,
    score: parseScore(payload.score ?? payload.scores),
    ball: parsePose(payload.ball ?? payload.b, { x: 550, y: 325 }),
    players,
    events: Array.isArray(payload.events) ? payload.events : [],
    receivedAt,
    stub: isStub,
  };
}

export function parseFinishedDetail(msg: ServerInboundMsg): {
  homeScore: number;
  awayScore: number;
  reason?: string;
} | null {
  const t = msg.t;
  if (t !== 'finished' && t !== 'matchEnded' && t !== 'match_ended' && t !== 'end') {
    return null;
  }
  const score = parseScore(msg.score ?? msg.scores ?? msg);
  return {
    homeScore: score.home,
    awayScore: score.away,
    reason: typeof msg.reason === 'string' ? msg.reason : undefined,
  };
}

export function toWsUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  return `wss://${trimmed}`;
}

export function getPublicGameServerUrl(): string | null {
  const raw = import.meta.env.PUBLIC_GAME_SERVER_URL;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim();
}

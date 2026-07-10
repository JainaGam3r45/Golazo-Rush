import { createMatch } from '../../../packages/game-sim/src/index.ts';

/**
 * @typedef {object} MatchInput
 * @property {number} seq
 * @property {number} [x]
 * @property {number} [y]
 * @property {boolean} [sprint]
 * @property {boolean} [shoot]
 * @property {boolean} [pass]
 * @property {boolean} [clear]
 * @property {boolean} [tackle]
 * @property {string} userId
 * @property {'home'|'away'} side
 */

/**
 * @typedef {object} MatchStartPlayer
 * @property {string} userId
 * @property {'home'|'away'} side
 */

/**
 * @typedef {object} MatchStartMeta
 * @property {number} [durationSeconds]
 * @property {string} [homeFormationId]
 * @property {string} [awayFormationId]
 * @property {string} [homeTeamId]
 * @property {string} [awayTeamId]
 * @property {Array<{nx:number,ny:number,role?:string}>} [homeLineup]
 * @property {Array<{nx:number,ny:number,role?:string}>} [awayLineup]
 */

/**
 * @typedef {object} MatchHost
 * @property {(roomId: string, players: MatchStartPlayer[], meta?: MatchStartMeta) => void} start
 * @property {(roomId: string, input: MatchInput) => void} applyInput
 * @property {(roomId: string) => object|null} snapshot
 * @property {(roomId: string) => object|null} consumeFinished
 * @property {(roomId: string) => void} stop
 * @property {(dtMs: number) => void} tick
 */

function toPlayerInput(input) {
  return {
    dirx: typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : 0,
    diry: typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : 0,
    sprint: Boolean(input.sprint),
    shoot: Boolean(input.shoot),
    pass: Boolean(input.pass),
    clear: Boolean(input.clear),
    tackle: Boolean(input.tackle),
    seq: Number(input.seq) || 0,
  };
}

function toWireSnapshot(simSnap) {
  return {
    tick: simSnap.tick,
    serverTime: Date.now(),
    timeMs: simSnap.timeMs,
    clockSeconds: simSnap.clockSeconds,
    clockMs: Math.round(simSnap.clockSeconds * 1000),
    durationSeconds: simSnap.durationSeconds,
    phase: simSnap.phase,
    score: simSnap.score,
    ball: simSnap.ball,
    players: simSnap.players.map((p) => ({
      id: p.id,
      side: p.side,
      slot: p.slot,
      role: p.role,
      kind: p.role === 'gk' ? 'gk' : p.kind,
      userId: p.kind === 'human' ? p.id : null,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
    })),
    humanSlots: simSnap.humanSlots,
    stub: false,
  };
}

/**
 * Authoritative host backed by @golazo-rush/game-sim (5v5, 1 human/side, bots fill).
 * @returns {MatchHost}
 */
export function createGameSimMatchHost() {
  /** @type {Map<string, { match: ReturnType<typeof createMatch>, meta: MatchStartMeta, finishedEmitted: boolean, finishedPayload: object|null }>} */
  const matches = new Map();

  return {
    start(roomId, players, meta = {}) {
      const home = players.find((p) => p.side === 'home');
      const away = players.find((p) => p.side === 'away');
      if (!home || !away) {
        throw new Error('home and away humans required');
      }
      const existing = matches.get(roomId);
      if (existing) existing.match; // replace
      const match = createMatch({
        durationSeconds: meta.durationSeconds ?? 180,
        homeFormationId: meta.homeFormationId ?? '4-4-2',
        awayFormationId: meta.awayFormationId ?? '4-4-2',
        homeLineup: Array.isArray(meta.homeLineup) ? meta.homeLineup : undefined,
        awayLineup: Array.isArray(meta.awayLineup) ? meta.awayLineup : undefined,
        homeHumanPlayerId: home.userId,
        awayHumanPlayerId: away.userId,
      });
      matches.set(roomId, {
        match,
        meta: {
          durationSeconds: meta.durationSeconds ?? 180,
          homeFormationId: meta.homeFormationId ?? '4-4-2',
          awayFormationId: meta.awayFormationId ?? '4-4-2',
          homeTeamId: meta.homeTeamId ?? null,
          awayTeamId: meta.awayTeamId ?? null,
          homeLineup: meta.homeLineup ?? null,
          awayLineup: meta.awayLineup ?? null,
        },
        finishedEmitted: false,
        finishedPayload: null,
      });
    },

    applyInput(roomId, input) {
      const entry = matches.get(roomId);
      if (!entry || entry.match.isFinished()) return;
      entry.match.applyInput(input.userId, toPlayerInput(input));
    },

    snapshot(roomId) {
      const entry = matches.get(roomId);
      if (!entry) return null;
      return toWireSnapshot(entry.match.getSnapshot());
    },

    consumeFinished(roomId) {
      const entry = matches.get(roomId);
      if (!entry || !entry.match.isFinished() || entry.finishedEmitted) return null;
      entry.finishedEmitted = true;
      const snap = entry.match.getSnapshot();
      entry.finishedPayload = {
        homeScore: snap.score.home,
        awayScore: snap.score.away,
        durationSeconds: snap.durationSeconds,
        homeTeamId: entry.meta.homeTeamId,
        awayTeamId: entry.meta.awayTeamId,
        reason: 'time',
      };
      return entry.finishedPayload;
    },

    stop(roomId) {
      matches.delete(roomId);
    },

    tick(dtMs) {
      for (const entry of matches.values()) {
        if (!entry.match.isFinished()) {
          entry.match.tick(dtMs);
        }
      }
    },
  };
}

/**
 * Probe-only host: echoes inputs, no physics (tests / fallback).
 * @returns {MatchHost}
 */
export function createStubMatchHost() {
  /** @type {Map<string, {tick: number, inputs: MatchInput[], players: MatchStartPlayer[], meta: MatchStartMeta}>} */
  const matches = new Map();

  return {
    start(roomId, players, meta = {}) {
      matches.set(roomId, { tick: 0, inputs: [], players, meta });
    },
    applyInput(roomId, input) {
      const m = matches.get(roomId);
      if (!m) return;
      m.inputs.push(input);
      if (m.inputs.length > 64) m.inputs.shift();
    },
    snapshot(roomId) {
      const m = matches.get(roomId);
      if (!m) return null;
      return {
        tick: m.tick,
        serverTime: Date.now(),
        phase: 'waiting',
        score: { home: 0, away: 0 },
        ball: { x: 550, y: 325, vx: 0, vy: 0 },
        players: [],
        stub: true,
        state: { stub: true, players: m.players, lastInputs: m.inputs.slice(-4) },
      };
    },
    consumeFinished() {
      return null;
    },
    stop(roomId) {
      matches.delete(roomId);
    },
    tick(dtMs) {
      const step = Math.max(1, Math.round(dtMs / 50));
      for (const m of matches.values()) m.tick += step;
    },
  };
}

/**
 * @param {ReturnType<import('./logger.js').createLogger>} log
 * @param {{ forceStub?: boolean }} [opts]
 * @returns {Promise<MatchHost>}
 */
export async function loadMatchHost(log, opts = {}) {
  if (opts.forceStub) {
    log.info('match_host_stub', { note: 'forced' });
    return createStubMatchHost();
  }
  try {
    const host = createGameSimMatchHost();
    log.info('match_host_loaded', { source: 'packages/game-sim' });
    return host;
  } catch (err) {
    log.warn('match_host_sim_failed', { err: err?.message });
    log.info('match_host_stub', { note: 'fallback' });
    return createStubMatchHost();
  }
}

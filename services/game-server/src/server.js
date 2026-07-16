import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { isOriginAllowed } from './config.js';
import { createAuthVerifier, redactToken } from './auth.js';
import { RoomRegistry, checkRateLimit } from './rooms.js';
import { createRoomApiHandler } from './roomApi.js';
import { loadMatchHost } from './matchHost.js';
import { createResultPersister } from './resultPersist.js';

/**
 * @param {object} opts
 * @param {import('./config.js').ServerConfig} opts.config
 * @param {ReturnType<import('./logger.js').createLogger>} opts.log
 * @param {import('./auth.js').AuthVerifier} [opts.authVerifier]
 * @param {import('./matchHost.js').MatchHost} [opts.matchHost]
 * @param {(result: object) => Promise<object>} [opts.persistResult]
 */
export async function createGameServer({ config, log, authVerifier, matchHost, persistResult }) {
  const auth = authVerifier ?? createAuthVerifier(config, log);
  // Humans (≤4) + spectators (≤8), hard-capped by maxPerRoom=10
  const rooms = new RoomRegistry({ maxPerRoom: 10, maxSpectators: 8 });
  const host = matchHost ?? (await loadMatchHost(log));
  const handleRoomApi = createRoomApiHandler({ config, log });
  const persist = persistResult ?? createResultPersister({ config, log });

  /** @type {Map<import('ws').WebSocket, { roomId: string|null, connectionId: string|null, userId: string|null, role: 'player'|'spectator'|null, joined: boolean }>} */
  const socketMeta = new Map();

  /**
   * @typedef {object} MatchSession
   * @property {string} [home]
   * @property {string} [away]
   * @property {boolean} started
   * @property {boolean} finishedNotified
   * @property {boolean} [allowBots]
   * @property {number} [durationSeconds]
   * @property {string} [homeFormationId]
   * @property {string} [awayFormationId]
   * @property {string} [homeTeamId]
   * @property {string} [awayTeamId]
   */

  /** @type {Map<string, MatchSession>} */
  const matchSessions = new Map();

  let shuttingDown = false;
  let heartbeatTimer = null;
  let tickTimer = null;
  let snapshotTimer = null;

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !isOriginAllowed(origin, config)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'origin_not_allowed' }));
      return;
    }

    if (origin && isOriginAllowed(origin, config)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'golazo-game-server',
          rooms: rooms.roomCount(),
          connections: rooms.connectionCount(),
          authMode: config.wsAuthMode,
        }),
      );
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/room' || url.pathname === '/api/room')) {
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > config.maxMessageBytes * 16) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'payload_too_large', code: 'PAYLOAD_TOO_LARGE' }));
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request', code: 'BAD_REQUEST' }));
        return;
      }
      const bodyText = Buffer.concat(chunks).toString('utf8');
      await handleRoomApi(req, res, bodyText);
      return;
    }

    // Local/bot match results — mirrors broken edge function record-match-result.
    if (
      req.method === 'POST' &&
      (url.pathname === '/record-result' || url.pathname === '/api/record-result')
    ) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized', code: 'UNAUTHORIZED' }));
        return;
      }
      const user = await auth.verify(token).catch(() => null);
      if (!user?.userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized', code: 'UNAUTHORIZED' }));
        return;
      }

      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > config.maxMessageBytes * 16) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'payload_too_large', code: 'PAYLOAD_TOO_LARGE' }));
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request', code: 'BAD_REQUEST' }));
        return;
      }

      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json', code: 'BAD_REQUEST' }));
        return;
      }

      const result = await persist({
        homeTeamId: body?.homeTeamId,
        awayTeamId: body?.awayTeamId,
        homeScore: body?.homeScore,
        awayScore: body?.awayScore,
        durationSeconds: body?.durationSeconds,
        decidedBy: 'local',
      });

      if (!result?.ok) {
        const status = result?.reason === 'missing_admin_credentials' ? 503 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result?.reason || 'persist_failed', code: 'PERSIST_FAILED' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          matchId: result.matchId,
          homeScore: body.homeScore,
          awayScore: body.awayScore,
          winnerTeamId: result.winnerTeamId ?? null,
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes,
  });

  server.on('upgrade', (req, socket, head) => {
    if (shuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, config)) {
      log.warn('ws_origin_rejected', { origin: origin || null });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    socketMeta.set(ws, {
      roomId: null,
      connectionId: null,
      userId: null,
      role: null,
      joined: false,
    });

    ws.on('message', async (raw, isBinary) => {
      const meta = socketMeta.get(ws);
      if (!meta || shuttingDown) return;

      if (isBinary) {
        send(ws, { t: 'error', code: 'INVALID_MESSAGE', message: 'Binary frames not allowed' });
        return;
      }

      const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
      if (Buffer.byteLength(text, 'utf8') > config.maxMessageBytes) {
        send(ws, { t: 'error', code: 'MESSAGE_TOO_LARGE', message: 'Message too large' });
        ws.close(1009, 'message too large');
        return;
      }

      if (meta.connectionId && meta.roomId) {
        const room = rooms.get(meta.roomId);
        const conn = room?.connections.get(meta.connectionId);
        if (conn) {
          conn.lastSeenAt = Date.now();
          if (!checkRateLimit(conn, config.maxMessagesPerSecond)) {
            send(ws, { t: 'error', code: 'RATE_LIMITED', message: 'Too many messages' });
            return;
          }
        }
      }

      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        send(ws, { t: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' });
        return;
      }

      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
        send(ws, { t: 'error', code: 'INVALID_MESSAGE', message: 'Missing type' });
        return;
      }

      try {
        await handleClientMessage(ws, meta, msg);
      } catch (err) {
        log.warn('ws_handler_error', { code: err?.code, err: err?.message });
        send(ws, {
          t: 'error',
          code: err?.code || 'INTERNAL_ERROR',
          message: err?.message || 'Internal error',
        });
      }
    });

    ws.on('close', () => {
      cleanupSocket(ws);
    });

    ws.on('error', (err) => {
      log.debug('ws_socket_error', { err: err?.message });
      cleanupSocket(ws);
    });
  });

  async function handleClientMessage(ws, meta, msg) {
    switch (msg.t) {
      case 'join': {
        if (meta.joined) {
          send(ws, { t: 'error', code: 'ALREADY_JOINED', message: 'Already joined' });
          return;
        }
        if (typeof msg.roomId !== 'string' || !msg.roomId.trim()) {
          send(ws, { t: 'error', code: 'INVALID_ROOM', message: 'roomId required' });
          return;
        }
        if (typeof msg.token !== 'string' || !msg.token) {
          send(ws, { t: 'error', code: 'UNAUTHORIZED', message: 'token required' });
          return;
        }
        const role = msg.role === 'spectator' ? 'spectator' : 'player';
        const identity = await auth.verify(msg.token);
        log.info('ws_join', {
          roomId: msg.roomId,
          userId: identity.userId,
          role,
          token: redactToken(msg.token),
        });
        const { room, conn, peers } = rooms.join(msg.roomId.trim(), ws, identity.userId, {
          role,
        });
        meta.roomId = room.roomId;
        meta.connectionId = conn.connectionId;
        meta.userId = identity.userId;
        meta.role = role;
        meta.joined = true;
        send(ws, {
          t: 'joined',
          roomId: room.roomId,
          connectionId: conn.connectionId,
          role,
        });
        for (const peer of room.connections.values()) {
          if (peer.connectionId !== conn.connectionId) {
            send(peer.socket, { t: 'peerJoined' });
            send(ws, { t: 'peerJoined' });
          }
        }
        send(ws, { t: 'probeState', seq: 0, clients: peers });

        // Late spectate: if match already running, push current snapshot immediately.
        if (role === 'spectator') {
          const session = matchSessions.get(room.roomId);
          if (session?.started) {
            const snap = host.snapshot(room.roomId);
            if (snap) send(ws, { t: 'matchSnapshot', ...snap });
            send(ws, { t: 'matchSpectating', roomId: room.roomId });
          }
        }
        return;
      }
      case 'ping': {
        if (typeof msg.clientTime !== 'number') {
          send(ws, { t: 'error', code: 'INVALID_MESSAGE', message: 'clientTime required' });
          return;
        }
        send(ws, { t: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        return;
      }
      case 'probeInput':
      case 'matchInput':
      case 'input': {
        if (!meta.joined || !meta.roomId) {
          send(ws, { t: 'error', code: 'NOT_JOINED', message: 'Join first' });
          return;
        }
        if (meta.role === 'spectator') {
          send(ws, {
            t: 'error',
            code: 'SPECTATOR_READONLY',
            message: 'Spectators cannot send input',
          });
          return;
        }
        const seq = typeof msg.seq === 'number' ? msg.seq : NaN;
        if (!Number.isFinite(seq)) {
          send(ws, { t: 'error', code: 'INVALID_INPUT', message: 'seq required' });
          return;
        }
        let x = typeof msg.x === 'number' ? msg.x : undefined;
        let y = typeof msg.y === 'number' ? msg.y : undefined;
        const buttons = msg.buttons && typeof msg.buttons === 'object' ? msg.buttons : null;
        if ((x === undefined || y === undefined) && buttons) {
          let ax = 0;
          let ay = 0;
          if (buttons.left) ax -= 1;
          if (buttons.right) ax += 1;
          if (buttons.up) ay -= 1;
          if (buttons.down) ay += 1;
          if (ax !== 0 || ay !== 0) {
            const len = Math.hypot(ax, ay) || 1;
            ax /= len;
            ay /= len;
          }
          x = ax;
          y = ay;
        }
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
          send(ws, { t: 'error', code: 'INVALID_INPUT', message: 'seq/x/y required' });
          return;
        }
        const room = rooms.get(meta.roomId);
        if (!room) return;
        if (msg.t === 'probeInput') {
          for (const peer of room.connections.values()) {
            send(peer.socket, { t: 'probeState', seq, clients: room.connections.size });
          }
        }
        const session = matchSessions.get(meta.roomId);
        if (session?.started && meta.userId) {
          const human =
            session.humans instanceof Map
              ? session.humans.get(meta.userId)
              : null;
          const side =
            human?.side ??
            (session.home === meta.userId
              ? 'home'
              : session.away === meta.userId
                ? 'away'
                : null);
          if (side) {
            host.applyInput(meta.roomId, {
              seq,
              x,
              y,
              sprint: Boolean(buttons?.sprint ?? msg.sprint),
              shoot: Boolean(buttons?.shoot ?? msg.shoot),
              pass: Boolean(buttons?.pass ?? msg.pass),
              clear: Boolean(buttons?.clear ?? msg.clear),
              tackle: Boolean(buttons?.tackle ?? msg.tackle),
              userId: meta.userId,
              side,
            });
          }
        }
        return;
      }
      case 'matchJoin': {
        // After room countdown: bind side + fieldSlot; start when all expected humans joined.
        if (!meta.joined || !meta.roomId || !meta.userId) {
          send(ws, { t: 'error', code: 'NOT_JOINED', message: 'Join first' });
          return;
        }
        if (meta.role === 'spectator') {
          send(ws, {
            t: 'error',
            code: 'SPECTATOR_READONLY',
            message: 'Spectators cannot join as players',
          });
          return;
        }
        if (msg.side !== 'home' && msg.side !== 'away') {
          send(ws, { t: 'error', code: 'INVALID_SIDE', message: 'side must be home|away' });
          return;
        }
        const fieldSlot =
          typeof msg.fieldSlot === 'number' && Number.isFinite(msg.fieldSlot)
            ? Math.max(0, Math.min(9, Math.floor(msg.fieldSlot)))
            : 0;

        let session = matchSessions.get(meta.roomId);
        if (!session) {
          session = {
            started: false,
            finishedNotified: false,
            humans: new Map(),
            expected: null,
          };
          matchSessions.set(meta.roomId, session);
        }
        if (!(session.humans instanceof Map)) {
          session.humans = new Map();
        }

        // Seat collision: same side+fieldSlot taken by another user
        for (const [uid, h] of session.humans) {
          if (uid !== meta.userId && h.side === msg.side && h.fieldSlot === fieldSlot) {
            send(ws, { t: 'error', code: 'SEAT_TAKEN', message: 'Seat already taken' });
            return;
          }
        }

        session.humans.set(meta.userId, {
          userId: meta.userId,
          side: msg.side,
          fieldSlot,
        });
        // Legacy single-id fields (first human per side) for older probes
        if (msg.side === 'home' && !session.home) session.home = meta.userId;
        if (msg.side === 'away' && !session.away) session.away = meta.userId;

        if (msg.allowBots === true) session.allowBots = true;
        if (typeof msg.durationSeconds === 'number') session.durationSeconds = msg.durationSeconds;
        if (typeof msg.homeFormationId === 'string') session.homeFormationId = msg.homeFormationId;
        if (typeof msg.awayFormationId === 'string') session.awayFormationId = msg.awayFormationId;
        if (typeof msg.homeTeamId === 'string') session.homeTeamId = msg.homeTeamId;
        if (typeof msg.awayTeamId === 'string') session.awayTeamId = msg.awayTeamId;
        if (Array.isArray(msg.homeLineup)) session.homeLineup = msg.homeLineup;
        if (Array.isArray(msg.awayLineup)) session.awayLineup = msg.awayLineup;

        if (Array.isArray(msg.humans) && msg.humans.length > 0) {
          session.expected = msg.humans
            .filter((h) => h && typeof h.userId === 'string' && (h.side === 'home' || h.side === 'away'))
            .map((h) => ({
              userId: h.userId,
              side: h.side === 'away' ? 'away' : 'home',
              fieldSlot:
                typeof h.fieldSlot === 'number' && Number.isFinite(h.fieldSlot)
                  ? Math.max(0, Math.min(9, Math.floor(h.fieldSlot)))
                  : 0,
            }));
        }

        if (!session.started) {
          /** @type {{ userId: string, side: 'home'|'away', fieldSlot: number }[]|null} */
          let startPlayers = null;
          if (Array.isArray(session.expected) && session.expected.length > 0) {
            if (session.expected.every((e) => session.humans.has(e.userId))) {
              startPlayers = session.expected.map((e) => {
                const live = session.humans.get(e.userId);
                return {
                  userId: e.userId,
                  side: live?.side ?? e.side,
                  fieldSlot: live?.fieldSlot ?? e.fieldSlot ?? 0,
                };
              });
            }
          } else {
            const list = [...session.humans.values()];
            const hasHome = list.some((h) => h.side === 'home');
            const hasAway = list.some((h) => h.side === 'away');
            if (hasHome && hasAway) {
              startPlayers = list;
            } else if (Boolean(session.allowBots) && list.length >= 1) {
              startPlayers = list;
            }
          }

          if (startPlayers) {
            session.started = true;
            host.start(meta.roomId, startPlayers, {
              durationSeconds: session.durationSeconds,
              homeFormationId: session.homeFormationId,
              awayFormationId: session.awayFormationId,
              homeTeamId: session.homeTeamId,
              awayTeamId: session.awayTeamId,
              homeLineup: session.homeLineup,
              awayLineup: session.awayLineup,
            });
            log.info('match_started', {
              roomId: meta.roomId,
              host: 'game-sim',
              allowBots: Boolean(session.allowBots),
              humans: startPlayers.length,
              sides: startPlayers.map((p) => `${p.side}:${p.fieldSlot}`),
            });
          }
        }
        send(ws, {
          t: 'matchJoined',
          roomId: meta.roomId,
          side: msg.side,
          fieldSlot,
          playerId: meta.userId,
        });
        return;
      }
      default:
        send(ws, { t: 'error', code: 'UNKNOWN_TYPE', message: `Unknown type ${msg.t}` });
    }
  }

  function cleanupSocket(ws) {
    const meta = socketMeta.get(ws);
    if (!meta) return;
    socketMeta.delete(ws);
    if (meta.roomId && meta.connectionId) {
      const result = rooms.leave(meta.roomId, meta.connectionId);
      if (!result.empty) {
        const room = rooms.get(meta.roomId);
        if (room) {
          for (const peer of room.connections.values()) {
            send(peer.socket, { t: 'peerLeft' });
            send(peer.socket, { t: 'probeState', seq: 0, clients: room.connections.size });
          }
        }
      } else {
        matchSessions.delete(meta.roomId);
        host.stop(meta.roomId);
        log.debug('room_removed', { roomId: meta.roomId });
      }
    }
  }

  function send(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function startLoops() {
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      rooms.forEachConnection((conn, room) => {
        if (now - conn.lastSeenAt > config.heartbeatTimeoutMs) {
          log.info('heartbeat_timeout', { roomId: room.roomId, connectionId: conn.connectionId });
          try {
            conn.socket.close(1001, 'heartbeat timeout');
          } catch {
            // ignore
          }
        }
      });
    }, config.heartbeatIntervalMs);
    if (heartbeatTimer.unref) heartbeatTimer.unref();

    const tickMs = Math.max(16, Math.round(1000 / config.tickHz));
    tickTimer = setInterval(() => {
      host.tick(tickMs);
    }, tickMs);
    if (tickTimer.unref) tickTimer.unref();

    const snapMs = Math.max(32, Math.round(1000 / config.snapshotHz));
    snapshotTimer = setInterval(() => {
      for (const [roomId, session] of matchSessions) {
        if (!session.started) continue;
        const snap = host.snapshot(roomId);
        if (!snap) continue;
        const room = rooms.get(roomId);
        if (!room) continue;
        for (const peer of room.connections.values()) {
          send(peer.socket, { t: 'matchSnapshot', ...snap });
        }

        if (!session.finishedNotified && typeof host.consumeFinished === 'function') {
          const finished = host.consumeFinished(roomId);
          if (finished) {
            session.finishedNotified = true;
            for (const peer of room.connections.values()) {
              send(peer.socket, {
                t: 'finished',
                score: { home: finished.homeScore, away: finished.awayScore },
                homeScore: finished.homeScore,
                awayScore: finished.awayScore,
                reason: finished.reason ?? 'time',
              });
            }
            void persist({
              ...finished,
              homeTeamId: finished.homeTeamId ?? session.homeTeamId,
              awayTeamId: finished.awayTeamId ?? session.awayTeamId,
            }).then((r) => {
              if (r?.ok) log.info('match_persisted', { roomId, matchId: r.matchId });
            });
          }
        }
      }
    }, snapMs);
    if (snapshotTimer.unref) snapshotTimer.unref();
  }

  function stopLoops() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    heartbeatTimer = tickTimer = snapshotTimer = null;
  }

  /**
   * @param {{ port?: number }} [listenOpts]
   */
  async function listen(listenOpts = {}) {
    const port = listenOpts.port ?? config.port;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    startLoops();
    log.info('listening', { port, authMode: config.wsAuthMode });
    return port;
  }

  async function close() {
    if (shuttingDown) return;
    shuttingDown = true;
    stopLoops();
    log.info('shutting_down');

    for (const client of wss.clients) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        // ignore
      }
    }

    await new Promise((resolve) => {
      wss.close(() => resolve());
    });

    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    rooms.clear();
    matchSessions.clear();
    socketMeta.clear();
    log.info('shutdown_complete');
  }

  return {
    server,
    wss,
    rooms,
    matchSessions,
    listen,
    close,
    get address() {
      return server.address();
    },
  };
}

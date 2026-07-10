import {
  buttonsToAxis,
  emptyButtons,
  getPublicGameServerUrl,
  parseFinishedDetail,
  parseMatchSnap,
  parseServerMessage,
  toWsUrl,
  type ClientOutboundMsg,
  type OnlineConnStatus,
  type OnlineInputButtons,
  type OnlineMatchSnap,
  type ServerInboundMsg,
} from './onlineProtocol.ts';
import { resolveOnlineAccessToken } from './onlineAuth.ts';
import { buttonsEqual } from './onlineInput.ts';

export type OnlineClientOptions = {
  roomId: string;
  playerSide?: 'home' | 'away';
  /** Optional one-time match session from room start (when server issues it). */
  matchSessionToken?: string | null;
  /** Override PUBLIC_GAME_SERVER_URL (diagnostic). */
  serverUrl?: string | null;
  /** Force token (diagnostic / tests). Prefer SDK resolution in production. */
  accessToken?: string | null;
  /**
   * Also emit future matchInput/input envelopes after snaps with poses.
   * Default false — current game-server only accepts probeInput + matchJoin.
   */
  sendFutureInputTypes?: boolean;
  pingIntervalMs?: number;
  inputHz?: number;
  durationSeconds?: number;
  homeFormationId?: string;
  awayFormationId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeLineup?: Array<{ nx: number; ny: number; role?: string }>;
  awayLineup?: Array<{ nx: number; ny: number; role?: string }>;
};

export type OnlineClientHandlers = {
  onStatus?: (status: OnlineConnStatus, detail?: string) => void;
  onPing?: (rttMs: number) => void;
  onMessage?: (msg: ServerInboundMsg) => void;
  onSnap?: (snap: OnlineMatchSnap) => void;
  onJoined?: (msg: ServerInboundMsg) => void;
  onMatchJoined?: (msg: ServerInboundMsg) => void;
  onFinished?: (detail: { homeScore: number; awayScore: number; reason?: string }) => void;
  onError?: (message: string) => void;
};

export type OnlineGameClient = {
  connect(): Promise<void>;
  disconnect(): void;
  getStatus(): OnlineConnStatus;
  getPingMs(): number | null;
  getLastSnap(): OnlineMatchSnap | null;
  setButtons(buttons: OnlineInputButtons, aim?: number): void;
  sendPing(): void;
};

export type OnlineMatchStartDetail = {
  roomId: string;
  code?: string;
  matchSessionToken?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeFormationId: string;
  awayFormationId: string;
  durationSeconds: number;
  playerSide: 'home' | 'away';
  localMatchId?: string;
  formatId?: '5v5' | '11v11';
  homeLineup?: Array<{ nx: number; ny: number; role?: string }>;
  awayLineup?: Array<{ nx: number; ny: number; role?: string }>;
};

function emitStatus(
  handlers: OnlineClientHandlers,
  status: OnlineConnStatus,
  detail?: string,
): void {
  handlers.onStatus?.(status, detail);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('golazo:online-conn', {
        detail: { status, detail: detail ?? null, at: Date.now() },
      }),
    );
  }
}

function isUnauthorizedMessage(msg: ServerInboundMsg): boolean {
  if (msg.t !== 'error') return false;
  const code = typeof msg.code === 'string' ? msg.code.toUpperCase() : '';
  if (code === 'UNAUTHORIZED' || code === 'AUTH_EXPIRED' || code === 'TOKEN_EXPIRED') {
    return true;
  }
  const text = [
    typeof msg.message === 'string' ? msg.message : '',
    typeof msg.error === 'string' ? msg.error : '',
  ]
    .join(' ')
    .toLowerCase();
  return text.includes('token') && (text.includes('invalid') || text.includes('expired') || text.includes('required'));
}

export function createOnlineGameClient(
  options: OnlineClientOptions,
  handlers: OnlineClientHandlers = {},
): OnlineGameClient {
  let socket: WebSocket | null = null;
  let status: OnlineConnStatus = 'idle';
  let pingMs: number | null = null;
  let lastSnap: OnlineMatchSnap | null = null;
  let seq = 0;
  let lastSent = emptyButtons();
  let pendingButtons = emptyButtons();
  let pendingAim: number | undefined;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let inputTimer: ReturnType<typeof setInterval> | null = null;
  let awaitingPongAt: number | null = null;
  let sawPoseSnap = false;
  let matchJoinSent = false;
  let closedByUser = false;
  let connectLock: Promise<void> | null = null;
  let authRetryUsed = false;
  let socketGeneration = 0;

  const pingIntervalMs = options.pingIntervalMs ?? 2000;
  const inputHz = options.inputHz ?? 20;
  const sendFutureInputTypes = options.sendFutureInputTypes ?? false;
  const playerSide = options.playerSide === 'away' ? 'away' : 'home';

  function setStatus(next: OnlineConnStatus, detail?: string) {
    status = next;
    emitStatus(handlers, next, detail);
  }

  function send(msg: ClientOutboundMsg) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
  }

  function maybeMatchJoin() {
    if (matchJoinSent) return;
    if (status !== 'joined' && status !== 'playing') return;
    matchJoinSent = true;
    send({
      t: 'matchJoin',
      side: playerSide,
      ...(typeof options.durationSeconds === 'number' ? { durationSeconds: options.durationSeconds } : {}),
      ...(options.homeFormationId ? { homeFormationId: options.homeFormationId } : {}),
      ...(options.awayFormationId ? { awayFormationId: options.awayFormationId } : {}),
      ...(options.homeTeamId ? { homeTeamId: options.homeTeamId } : {}),
      ...(options.awayTeamId ? { awayTeamId: options.awayTeamId } : {}),
      ...(options.homeLineup ? { homeLineup: options.homeLineup } : {}),
      ...(options.awayLineup ? { awayLineup: options.awayLineup } : {}),
    });
  }

  function flushInput(force = false) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (status !== 'joined' && status !== 'playing') return;

    const buttons = pendingButtons;
    if (!force && buttonsEqual(buttons, lastSent)) return;

    seq += 1;
    lastSent = { ...buttons };
    const axis = buttonsToAxis(buttons);

    send({
      t: 'probeInput',
      seq,
      x: axis.x,
      y: axis.y,
      buttons,
      sprint: buttons.sprint,
      shoot: buttons.shoot,
      pass: buttons.pass,
      clear: buttons.clear,
      tackle: buttons.tackle,
    });

    if (sendFutureInputTypes && sawPoseSnap) {
      const aim = pendingAim;
      const base = { seq, buttons, x: axis.x, y: axis.y, ...(aim !== undefined ? { aim } : {}) };
      send({ t: 'matchInput', ...base });
    }
  }

  function clearTimers() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (inputTimer) {
      clearInterval(inputTimer);
      inputTimer = null;
    }
  }

  function startLoops() {
    clearTimers();
    pingTimer = setInterval(() => {
      awaitingPongAt = Date.now();
      send({ t: 'ping', clientTime: awaitingPongAt });
    }, pingIntervalMs);

    const interval = Math.max(16, Math.round(1000 / inputHz));
    inputTimer = setInterval(() => flushInput(false), interval);
  }

  function tearDownSocket(markClosedByUser: boolean): Promise<void> {
    clearTimers();
    const current = socket;
    socket = null;
    if (!current) return Promise.resolve();
    if (markClosedByUser) closedByUser = true;

    return new Promise((resolve) => {
      const finish = () => {
        try {
          current.onopen = null;
          current.onmessage = null;
          current.onerror = null;
          current.onclose = null;
        } catch {
          // ignore
        }
        resolve();
      };

      if (
        current.readyState === WebSocket.CLOSED ||
        current.readyState === WebSocket.CLOSING
      ) {
        finish();
        return;
      }

      const timer = setTimeout(finish, 1500);
      current.onclose = () => {
        clearTimeout(timer);
        finish();
      };
      try {
        current.close();
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  }

  async function resolveToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && options.accessToken) {
      return options.accessToken;
    }
    const resolved = await resolveOnlineAccessToken({ forceRefresh });
    if (!resolved.token) {
      throw new Error(
        resolved.reason ?? 'No hay access token para unirse al servidor de partida',
      );
    }
    return resolved.token;
  }

  function openSocket(token: string): Promise<void> {
    const base = options.serverUrl ?? getPublicGameServerUrl();
    if (!base) {
      const err = 'PUBLIC_GAME_SERVER_URL no configurada';
      setStatus('error', err);
      handlers.onError?.(err);
      return Promise.reject(new Error(err));
    }

    const generation = ++socketGeneration;
    matchJoinSent = false;
    sawPoseSnap = false;
    closedByUser = false;
    setStatus('connecting');

    const url = toWsUrl(base);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        setStatus('error', 'No se pudo abrir WebSocket');
        reject(err);
        return;
      }

      socket = ws;

      ws.onopen = () => {
        if (generation !== socketGeneration || socket !== ws) return;
        setStatus('authenticating');
        send({
          t: 'join',
          roomId: options.roomId,
          token,
          formatId: '5v5',
          ...(options.matchSessionToken
            ? { matchSessionToken: options.matchSessionToken }
            : {}),
        });
        startLoops();
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (event) => {
        if (generation !== socketGeneration || socket !== ws) return;
        handleMessage(event.data);
      };

      ws.onerror = () => {
        if (generation !== socketGeneration || socket !== ws) return;
        handlers.onError?.('Error de WebSocket');
        if (!settled) {
          settled = true;
          setStatus('error', 'Error de WebSocket');
          reject(new Error('WebSocket error'));
        }
      };

      ws.onclose = () => {
        if (generation !== socketGeneration) return;
        clearTimers();
        if (socket === ws) socket = null;
        if (closedByUser) {
          setStatus('closed');
          return;
        }
        if (status !== 'error') setStatus('closed', 'Conexión cerrada');
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket closed before open'));
        }
      };
    });
  }

  async function reauthWithFreshToken(): Promise<void> {
    await tearDownSocket(false);
    setStatus('authenticating', 'Renovando sesión…');
    try {
      const token = await resolveToken(true);
      await openSocket(token);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo renovar el access token';
      setStatus('error', message);
      handlers.onError?.(message);
    }
  }

  function handleMessage(raw: unknown) {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    handlers.onMessage?.(msg);

    if (msg.t === 'pong') {
      if (awaitingPongAt != null) {
        pingMs = Math.max(0, Date.now() - awaitingPongAt);
        awaitingPongAt = null;
        handlers.onPing?.(pingMs);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('golazo:online-ping', { detail: { rttMs: pingMs } }),
          );
        }
      }
      return;
    }

    if (msg.t === 'welcome' || msg.t === 'peerJoined' || msg.t === 'peerLeft' || msg.t === 'probeState') {
      return;
    }

    if (msg.t === 'joined' || msg.t === 'joinOk' || msg.t === 'join_ok') {
      setStatus('joined');
      handlers.onJoined?.(msg);
      maybeMatchJoin();
      return;
    }

    if (msg.t === 'matchJoined') {
      handlers.onMatchJoined?.(msg);
      if (status !== 'playing') setStatus('playing');
      return;
    }

    const snap = parseMatchSnap(msg);
    if (snap) {
      lastSnap = snap;
      if (!snap.stub && (snap.players.length > 0 || snap.phase === 'playing')) {
        sawPoseSnap = true;
        if (status !== 'playing') setStatus('playing');
      }
      handlers.onSnap?.(snap);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('golazo:online-snap', {
            detail: {
              tick: snap.tick,
              phase: snap.phase,
              score: snap.score,
              stub: Boolean(snap.stub),
            },
          }),
        );
      }
      return;
    }

    const finished = parseFinishedDetail(msg);
    if (finished) {
      handlers.onFinished?.(finished);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('golazo:online-match-finished', { detail: finished }),
        );
      }
      return;
    }

    if (msg.t === 'error') {
      if (isUnauthorizedMessage(msg) && !authRetryUsed && !closedByUser) {
        authRetryUsed = true;
        void reauthWithFreshToken();
        return;
      }

      const message =
        (typeof msg.message === 'string' && msg.message) ||
        (typeof msg.error === 'string' && msg.error) ||
        (typeof msg.code === 'string' && msg.code) ||
        'Error del servidor de partida';
      handlers.onError?.(message);
      setStatus('error', message);
    }
  }

  async function connect(): Promise<void> {
    if (connectLock) return connectLock;

    connectLock = (async () => {
      await tearDownSocket(false);
      authRetryUsed = false;
      matchJoinSent = false;
      sawPoseSnap = false;

      const token = await resolveToken(false);
      await openSocket(token);
    })().finally(() => {
      connectLock = null;
    });

    return connectLock;
  }

  function disconnect() {
    closedByUser = true;
    socketGeneration += 1;
    void tearDownSocket(true);
    setStatus('closed');
  }

  return {
    connect,
    disconnect,
    getStatus: () => status,
    getPingMs: () => pingMs,
    getLastSnap: () => lastSnap,
    setButtons(buttons, aim) {
      pendingButtons = { ...buttons };
      pendingAim = aim;
    },
    sendPing() {
      awaitingPongAt = Date.now();
      send({ t: 'ping', clientTime: awaitingPongAt });
    },
  };
}

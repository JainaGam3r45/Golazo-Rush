import { ensureAccessToken, hydrateSession } from '../auth/session';
import { insforge, isInsForgeConfigured } from '../insforge';
import { resolveOnlineAccessToken } from './onlineAuth';
import { getPublicGameServerUrl, toHttpUrl } from './onlineProtocol';
import type { FormationId } from './formations';
import type { RoomChatMessage, RoomSnapshot } from './roomTypes';
import {
  ROOM_ERROR_MESSAGES,
  buildRoomRpcCall,
  mapRoomRpcErrorMessage,
  selectRoomTransport,
  type PrivateRoomError,
} from './privateRoomRpc';

export type { PrivateRoomError, RoomTransport, RoomRpcCall } from './privateRoomRpc';
export {
  ROOM_ERROR_MESSAGES,
  buildRoomRpcCall,
  mapRoomRpcErrorMessage,
  selectRoomTransport,
} from './privateRoomRpc';

type InvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PrivateRoomError };

function roomHttpBase(serverUrl: string): string {
  return toHttpUrl(serverUrl);
}

function parseErrorPayload(raw: unknown): { code?: string; error?: string } | null {
  if (!raw) return null;
  if (typeof raw === 'object') {
    return raw as { code?: string; error?: string };
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as { code?: string; error?: string };
    } catch {
      return null;
    }
  }
  return null;
}

function toInvokeError(
  payload: { code?: string; error?: string } | null,
  fallbackMessage: string,
  fallbackCode = 'INVOKE_ERROR',
): PrivateRoomError {
  return {
    code: payload?.code ?? fallbackCode,
    message: payload?.error ?? fallbackMessage,
  };
}

async function ensureSessionForRpc(): Promise<PrivateRoomError | null> {
  await hydrateSession();
  const token = await ensureAccessToken();
  if (!token) {
    const { getAuthState } = await import('../auth/session');
    const auth = getAuthState();
    if (!auth.user) {
      return { code: 'UNAUTHORIZED', message: ROOM_ERROR_MESSAGES.UNAUTHORIZED };
    }
    return {
      code: 'UNAUTHORIZED',
      message: auth.tokenError ?? ROOM_ERROR_MESSAGES.UNAUTHORIZED,
    };
  }

  return null;
}

async function invokeViaRpc<T>(body: Record<string, unknown>): Promise<InvokeResult<T>> {
  if (!isInsForgeConfigured || !insforge) {
    return {
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: ROOM_ERROR_MESSAGES.NOT_CONFIGURED },
    };
  }

  const sessionError = await ensureSessionForRpc();
  if (sessionError) {
    return { ok: false, error: sessionError };
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const call = buildRoomRpcCall(action, body);
  if ('error' in call) {
    return { ok: false, error: call.error };
  }

  const { data, error } = await insforge.database.rpc(call.fn, call.args);

  if (error) {
    const anyErr = error as { message?: string; code?: string };
    return {
      ok: false,
      error: mapRoomRpcErrorMessage(anyErr.message ?? anyErr.code),
    };
  }

  if (call.shape === 'message') {
    return { ok: true, data: { message: data } as T };
  }
  if (call.shape === 'ok') {
    return { ok: true, data: { ok: true } as T };
  }
  if (data == null && (action === 'getActive' || action === 'recoverActive' || action === 'leaveActive')) {
    return { ok: true, data: { room: null } as T };
  }
  return { ok: true, data: { room: data } as T };
}

/**
 * Optional Compute path: POST `${PUBLIC_GAME_SERVER_URL}/room` with Bearer token.
 * Used only when InsForge client is not configured and a public game-server URL is set.
 */
async function invokeViaGameServer<T>(
  body: Record<string, unknown>,
  serverUrl: string,
  retried = false,
): Promise<InvokeResult<T>> {
  const { token, reason } = await resolveOnlineAccessToken({ forceRefresh: retried });
  if (!token) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: reason ?? 'No hay access token para la API de salas. Inicia sesión e inténtalo de nuevo.',
      },
    };
  }

  const url = `${roomHttpBase(serverUrl)}/room`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : ROOM_ERROR_MESSAGES.NETWORK_ERROR;
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message },
    };
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }

  if (res.status === 401 && !retried) {
    return invokeViaGameServer<T>(body, serverUrl, true);
  }

  if (!res.ok) {
    const payload = parseErrorPayload(data);
    return {
      ok: false,
      error: toInvokeError(
        payload,
        payload?.error ?? `Error HTTP ${res.status}`,
        res.status === 401
          ? 'UNAUTHORIZED'
          : res.status === 502 || res.status === 503
            ? 'SERVER_UNAVAILABLE'
            : 'ROOM_ERROR',
      ),
    };
  }

  if (data && typeof data === 'object' && 'error' in data) {
    const err = data as { error?: string; code?: string };
    return {
      ok: false,
      error: {
        code: err.code ?? 'ROOM_ERROR',
        message: err.error ?? ROOM_ERROR_MESSAGES.ROOM_ERROR,
      },
    };
  }

  return { ok: true, data: data as T };
}

async function invokeRoom<T>(body: Record<string, unknown>): Promise<InvokeResult<T>> {
  const gameServerUrl = getPublicGameServerUrl();
  const transport = selectRoomTransport({
    insforgeConfigured: isInsForgeConfigured,
    gameServerUrl,
  });

  if (transport === 'rpc') {
    return invokeViaRpc<T>(body);
  }

  if (transport === 'game-server' && gameServerUrl) {
    return invokeViaGameServer<T>(body, gameServerUrl);
  }

  return {
    ok: false,
    error: { code: 'NOT_CONFIGURED', message: ROOM_ERROR_MESSAGES.NOT_CONFIGURED },
  };
}

export async function createPrivateRoom(input: {
  teamId: string;
  formationId?: FormationId;
  durationSeconds?: number;
  lineup?: unknown;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'create',
    teamId: input.teamId,
    formationId: input.formationId,
    durationSeconds: input.durationSeconds,
    lineup: input.lineup,
  });
}

export async function joinPrivateRoom(input: {
  code: string;
  teamId: string;
  formationId?: FormationId;
  lineup?: unknown;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'join',
    code: input.code,
    teamId: input.teamId,
    formationId: input.formationId,
    lineup: input.lineup,
  });
}

export async function joinRoomAsSpectator(input: {
  code: string;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'joinSpectator',
    code: input.code,
  });
}

export async function leavePrivateRoom(roomId: string): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({ action: 'leave', roomId });
}

export async function updateRoomLoadout(input: {
  roomId: string;
  teamId?: string;
  formationId?: FormationId;
  lineup?: unknown;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'loadout',
    roomId: input.roomId,
    teamId: input.teamId,
    formationId: input.formationId,
    lineup: input.lineup,
  });
}

export async function claimRoomSeat(input: {
  roomId: string;
  side: 'home' | 'away';
  fieldSlot: number;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'claimSeat',
    roomId: input.roomId,
    side: input.side,
    fieldSlot: input.fieldSlot,
  });
}

export async function setRoomReady(
  roomId: string,
  ready: boolean,
): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({ action: 'ready', roomId, ready });
}

export async function startPrivateRoom(roomId: string): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({ action: 'start', roomId });
}

export async function getPrivateRoom(roomId: string): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({ action: 'get', roomId });
}

export async function sendRoomChat(
  roomId: string,
  message: string,
): Promise<InvokeResult<{ message: RoomChatMessage }>> {
  return invokeRoom({ action: 'chat', roomId, message });
}

export async function touchRoomPresence(roomId: string): Promise<InvokeResult<{ ok: boolean }>> {
  return invokeRoom({ action: 'touch', roomId });
}

export async function getActivePrivateRoom(): Promise<InvokeResult<{ room: RoomSnapshot | null }>> {
  return invokeRoom({ action: 'getActive' });
}

export async function recoverActivePrivateRoom(): Promise<InvokeResult<{ room: RoomSnapshot | null }>> {
  return invokeRoom({ action: 'recoverActive' });
}

export async function leaveActivePrivateRoom(): Promise<InvokeResult<{ room: RoomSnapshot | null }>> {
  return invokeRoom({ action: 'leaveActive' });
}

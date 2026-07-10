import { insforge, isInsForgeConfigured } from '../insforge';
import { resolveOnlineAccessToken } from './onlineAuth';
import { getPublicGameServerUrl } from './onlineProtocol';
import type { FormationId } from './formations';
import type { RoomChatMessage, RoomSnapshot } from './roomTypes';

export type PrivateRoomError = {
  code: string;
  message: string;
};

type InvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PrivateRoomError };

function roomHttpBase(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '');
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

/**
 * Prefer game-server when PUBLIC_GAME_SERVER_URL is set:
 * POST `${PUBLIC_GAME_SERVER_URL}/room` with the same action body as the
 * InsForge `private-room` function and `Authorization: Bearer <accessToken>`.
 *
 * Token from `resolveOnlineAccessToken` (SDK session / refresh). On 401, refresh once and retry.
 * Otherwise falls back to `insforge.functions.invoke('private-room')`.
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
    const message = err instanceof Error ? err.message : 'No se pudo contactar el servidor de salas';
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
        message: err.error ?? 'Error de sala',
      },
    };
  }

  return { ok: true, data: data as T };
}

async function invokeViaInsForge<T>(body: Record<string, unknown>): Promise<InvokeResult<T>> {
  if (!isInsForgeConfigured || !insforge) {
    return {
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'InsForge no está configurado' },
    };
  }

  const { data, error } = await insforge.functions.invoke('private-room', { body });

  if (error) {
    const anyErr = error as {
      message?: string;
      statusCode?: number;
      context?: { body?: unknown; json?: unknown };
    };
    const payload = parseErrorPayload(anyErr.context?.body ?? anyErr.context?.json);
    return {
      ok: false,
      error: toInvokeError(
        payload,
        payload?.error ?? anyErr.message ?? 'No se pudo completar la acción',
      ),
    };
  }

  if (data && typeof data === 'object' && 'error' in data) {
    const err = data as { error?: string; code?: string };
    return {
      ok: false,
      error: {
        code: err.code ?? 'ROOM_ERROR',
        message: err.error ?? 'Error de sala',
      },
    };
  }

  return { ok: true, data: data as T };
}

async function invokeRoom<T>(body: Record<string, unknown>): Promise<InvokeResult<T>> {
  const gameServerUrl = getPublicGameServerUrl();
  if (gameServerUrl) {
    return invokeViaGameServer<T>(body, gameServerUrl);
  }
  return invokeViaInsForge<T>(body);
}

export async function createPrivateRoom(input: {
  teamId: string;
  formationId?: FormationId;
  durationSeconds?: number;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'create',
    teamId: input.teamId,
    formationId: input.formationId,
    durationSeconds: input.durationSeconds,
  });
}

export async function joinPrivateRoom(input: {
  code: string;
  teamId: string;
  formationId?: FormationId;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'join',
    code: input.code,
    teamId: input.teamId,
    formationId: input.formationId,
  });
}

export async function leavePrivateRoom(roomId: string): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({ action: 'leave', roomId });
}

export async function updateRoomLoadout(input: {
  roomId: string;
  teamId?: string;
  formationId?: FormationId;
}): Promise<InvokeResult<{ room: RoomSnapshot }>> {
  return invokeRoom({
    action: 'loadout',
    roomId: input.roomId,
    teamId: input.teamId,
    formationId: input.formationId,
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

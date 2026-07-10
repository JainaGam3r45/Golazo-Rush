import { createAdminClient, createClient } from '@insforge/sdk';

const ACTIONS = new Set([
  'create',
  'join',
  'leave',
  'loadout',
  'ready',
  'start',
  'chat',
  'get',
  'touch',
]);

function mapRpcError(error) {
  const raw = error?.message ?? '';
  const codeMatch = raw.match(
    /\b(UNAUTHORIZED|ALREADY_IN_ROOM|INVALID_DURATION|INVALID_FORMATION|INVALID_TEAM|INVALID_CODE|ROOM_NOT_FOUND|ROOM_CLOSED|ROOM_EXPIRED|ROOM_FULL|TEAM_TAKEN|ROOM_LOCKED|NOT_A_MEMBER|NEED_OPPONENT|LOADOUT_INCOMPLETE|NOT_READY|NOT_HOST|START_CONFLICT|EMPTY_MESSAGE|MESSAGE_TOO_LONG|RATE_LIMITED|ROOM_CODE_COLLISION|ROOM_CREATE_FAILED)\b/,
  );
  const code = codeMatch?.[1] ?? 'INTERNAL_ERROR';

  const messages = {
    UNAUTHORIZED: 'Debes iniciar sesión',
    ALREADY_IN_ROOM: 'Ya estás en una sala activa',
    INVALID_DURATION: 'Duración no válida',
    INVALID_FORMATION: 'Formación no válida',
    INVALID_TEAM: 'Selección no válida',
    INVALID_CODE: 'Código de sala no válido',
    ROOM_NOT_FOUND: 'Sala no encontrada',
    ROOM_CLOSED: 'La sala ya no está disponible',
    ROOM_EXPIRED: 'La sala expiró',
    ROOM_FULL: 'La sala ya tiene dos jugadores',
    TEAM_TAKEN: 'Esa selección ya está ocupada',
    ROOM_LOCKED: 'La sala no admite cambios ahora',
    NOT_A_MEMBER: 'No eres miembro de esta sala',
    NEED_OPPONENT: 'Espera a que se una un rival',
    LOADOUT_INCOMPLETE: 'Elige selección y formación antes de listo',
    NOT_READY: 'Ambos jugadores deben estar listos',
    NOT_HOST: 'Solo el anfitrión puede iniciar',
    START_CONFLICT: 'No se pudo iniciar el partido',
    EMPTY_MESSAGE: 'El mensaje está vacío',
    MESSAGE_TOO_LONG: 'El mensaje es demasiado largo',
    RATE_LIMITED: 'Espera un momento antes de enviar otro mensaje',
    ROOM_CODE_COLLISION: 'No se pudo generar un código de sala',
    ROOM_CREATE_FAILED: 'No se pudo crear la sala',
    INTERNAL_ERROR: 'Error interno del servidor',
  };

  const statusByCode = {
    UNAUTHORIZED: 401,
    ALREADY_IN_ROOM: 409,
    ROOM_FULL: 409,
    TEAM_TAKEN: 409,
    RATE_LIMITED: 429,
    ROOM_NOT_FOUND: 404,
    NOT_A_MEMBER: 403,
    NOT_HOST: 403,
    INTERNAL_ERROR: 500,
  };

  return {
    status: statusByCode[code] ?? 400,
    code,
    message: messages[code] ?? messages.INTERNAL_ERROR,
  };
}

/**
 * HTTP room API mirroring private-room edge function.
 * Requires INSFORGE_BASE_URL + INSFORGE_API_KEY (server-only).
 */
export function createRoomApiHandler({ config, log }) {
  return async function handleRoomApi(req, res, bodyText) {
    if (!config.insforgeBaseUrl || !config.insforgeApiKey) {
      sendJson(res, 503, { error: 'Servidor no configurado', code: 'SERVER_MISCONFIGURED' });
      return;
    }

    const authHeader = req.headers.authorization;
    const userToken = authHeader?.replace(/^Bearer\s+/i, '') ?? null;
    if (!userToken) {
      sendJson(res, 401, { error: 'Debes iniciar sesión', code: 'UNAUTHORIZED' });
      return;
    }

    let userId;
    try {
      const userClient = createClient({
        baseUrl: config.insforgeBaseUrl,
        accessToken: userToken,
      });
      const { data, error } = await userClient.auth.getCurrentUser();
      userId = data?.user?.id ?? null;
      if (error || !userId) {
        sendJson(res, 401, { error: 'Sesión inválida', code: 'UNAUTHORIZED' });
        return;
      }
    } catch (err) {
      log.warn('room_api_auth_failed', { err: err?.message });
      sendJson(res, 401, { error: 'Sesión inválida', code: 'UNAUTHORIZED' });
      return;
    }

    let body;
    try {
      body = JSON.parse(bodyText || '{}');
    } catch {
      sendJson(res, 400, { error: 'Cuerpo JSON inválido', code: 'INVALID_JSON' });
      return;
    }

    const action = body.action;
    if (!action || !ACTIONS.has(action)) {
      sendJson(res, 400, { error: 'action no válida', code: 'INVALID_ACTION' });
      return;
    }

    let rpcName = '';
    let args = {};

    switch (action) {
      case 'create': {
        if (!body.teamId) {
          sendJson(res, 400, { error: 'teamId requerido', code: 'INVALID_TEAM' });
          return;
        }
        rpcName = 'create_private_room';
        args = {
          p_user_id: userId,
          p_team_id: body.teamId,
          p_formation_id: body.formationId ?? '4-4-2',
          p_duration_seconds: body.durationSeconds ?? 180,
        };
        break;
      }
      case 'join': {
        if (!body.code) {
          sendJson(res, 400, { error: 'code requerido', code: 'INVALID_CODE' });
          return;
        }
        if (!body.teamId) {
          sendJson(res, 400, { error: 'teamId requerido', code: 'INVALID_TEAM' });
          return;
        }
        rpcName = 'join_private_room';
        args = {
          p_user_id: userId,
          p_code: body.code,
          p_team_id: body.teamId,
          p_formation_id: body.formationId ?? '4-4-2',
        };
        break;
      }
      case 'leave': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        rpcName = 'leave_private_room';
        args = { p_user_id: userId, p_room_id: body.roomId };
        break;
      }
      case 'loadout': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        if (!body.teamId && !body.formationId) {
          sendJson(res, 400, { error: 'teamId o formationId requerido', code: 'INVALID_TEAM' });
          return;
        }
        rpcName = 'update_room_loadout';
        args = {
          p_user_id: userId,
          p_room_id: body.roomId,
          p_team_id: body.teamId ?? null,
          p_formation_id: body.formationId ?? null,
        };
        break;
      }
      case 'ready': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        if (typeof body.ready !== 'boolean') {
          sendJson(res, 400, { error: 'ready requerido', code: 'INVALID_ACTION' });
          return;
        }
        rpcName = 'set_room_ready';
        args = { p_user_id: userId, p_room_id: body.roomId, p_ready: body.ready };
        break;
      }
      case 'start': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        rpcName = 'start_private_room';
        args = { p_user_id: userId, p_room_id: body.roomId };
        break;
      }
      case 'chat': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        if (typeof body.message !== 'string') {
          sendJson(res, 400, { error: 'message requerido', code: 'EMPTY_MESSAGE' });
          return;
        }
        const trimmed = body.message.trim();
        if (!trimmed) {
          sendJson(res, 400, { error: 'El mensaje está vacío', code: 'EMPTY_MESSAGE' });
          return;
        }
        if (trimmed.length > 200) {
          sendJson(res, 400, { error: 'El mensaje es demasiado largo', code: 'MESSAGE_TOO_LONG' });
          return;
        }
        const sanitized = trimmed.replace(/[<>]/g, '');
        rpcName = 'publish_room_chat';
        args = { p_user_id: userId, p_room_id: body.roomId, p_body: sanitized };
        break;
      }
      case 'get': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        rpcName = 'get_private_room';
        args = { p_user_id: userId, p_room_id: body.roomId };
        break;
      }
      case 'touch': {
        if (!body.roomId) {
          sendJson(res, 400, { error: 'roomId requerido', code: 'ROOM_NOT_FOUND' });
          return;
        }
        rpcName = 'touch_room_presence';
        args = { p_user_id: userId, p_room_id: body.roomId };
        break;
      }
      default:
        sendJson(res, 400, { error: 'action no válida', code: 'INVALID_ACTION' });
        return;
    }

    try {
      const admin = createAdminClient({
        baseUrl: config.insforgeBaseUrl,
        apiKey: config.insforgeApiKey,
      });
      const { data, error } = await admin.database.rpc(rpcName, args);
      if (error) {
        const mapped = mapRpcError(error);
        sendJson(res, mapped.status, { error: mapped.message, code: mapped.code });
        return;
      }
      if (action === 'chat') {
        sendJson(res, 200, { message: data });
        return;
      }
      if (action === 'touch') {
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 200, { room: data });
    } catch (err) {
      log.error('room_api_rpc_failed', { action, err: err?.message });
      sendJson(res, 500, { error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
    }
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export { mapRpcError, ACTIONS };

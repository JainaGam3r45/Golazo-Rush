import { createAdminClient, createClient } from 'npm:@insforge/sdk@^0.0.26';

type RoomAction =
  | 'create'
  | 'join'
  | 'leave'
  | 'loadout'
  | 'ready'
  | 'start'
  | 'chat'
  | 'get'
  | 'touch';

type RoomBody = {
  action?: RoomAction;
  code?: string;
  roomId?: string;
  teamId?: string;
  formationId?: string;
  durationSeconds?: number;
  ready?: boolean;
  message?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function mapRpcError(error: { message?: string } | null): { status: number; code: string; message: string } {
  const raw = error?.message ?? '';
  const codeMatch = raw.match(
    /\b(UNAUTHORIZED|ALREADY_IN_ROOM|INVALID_DURATION|INVALID_FORMATION|INVALID_TEAM|INVALID_CODE|ROOM_NOT_FOUND|ROOM_CLOSED|ROOM_EXPIRED|ROOM_FULL|TEAM_TAKEN|ROOM_LOCKED|NOT_A_MEMBER|NEED_OPPONENT|LOADOUT_INCOMPLETE|NOT_READY|NOT_HOST|START_CONFLICT|EMPTY_MESSAGE|MESSAGE_TOO_LONG|RATE_LIMITED|ROOM_CODE_COLLISION|ROOM_CREATE_FAILED)\b/,
  );
  const code = codeMatch?.[1] ?? 'INTERNAL_ERROR';

  const messages: Record<string, string> = {
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

  const statusByCode: Record<string, number> = {
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

async function requireUser(req: Request): Promise<
  | { ok: true; userId: string; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; response: Response }
> {
  const apiKey = Deno.env.get('INSFORGE_API_KEY');
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');

  if (!apiKey || !baseUrl) {
    return { ok: false, response: json({ error: 'Servidor no configurado', code: 'SERVER_MISCONFIGURED' }, 503) };
  }

  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader?.replace(/^Bearer\s+/i, '') ?? null;
  if (!userToken) {
    return { ok: false, response: json({ error: 'Debes iniciar sesión', code: 'UNAUTHORIZED' }, 401) };
  }

  const userClient = createClient({ baseUrl, accessToken: userToken });
  const { data, error } = await userClient.auth.getCurrentUser();
  const userId = data?.user?.id ?? null;

  if (error || !userId) {
    return { ok: false, response: json({ error: 'Sesión inválida', code: 'UNAUTHORIZED' }, 401) };
  }

  return { ok: true, userId, admin: createAdminClient({ baseUrl, apiKey }) };
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: RoomBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido', code: 'INVALID_JSON' }, 400);
  }

  const action = body.action;
  if (!action) {
    return json({ error: 'action requerido', code: 'INVALID_ACTION' }, 400);
  }

  const { userId, admin } = auth;
  let rpcName = '';
  let args: Record<string, unknown> = {};

  switch (action) {
    case 'create': {
      if (!body.teamId) return json({ error: 'teamId requerido', code: 'INVALID_TEAM' }, 400);
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
      if (!body.code) return json({ error: 'code requerido', code: 'INVALID_CODE' }, 400);
      if (!body.teamId) return json({ error: 'teamId requerido', code: 'INVALID_TEAM' }, 400);
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
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      rpcName = 'leave_private_room';
      args = { p_user_id: userId, p_room_id: body.roomId };
      break;
    }
    case 'loadout': {
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      if (!body.teamId && !body.formationId) {
        return json({ error: 'teamId o formationId requerido', code: 'INVALID_TEAM' }, 400);
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
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      if (typeof body.ready !== 'boolean') {
        return json({ error: 'ready requerido', code: 'INVALID_ACTION' }, 400);
      }
      rpcName = 'set_room_ready';
      args = { p_user_id: userId, p_room_id: body.roomId, p_ready: body.ready };
      break;
    }
    case 'start': {
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      rpcName = 'start_private_room';
      args = { p_user_id: userId, p_room_id: body.roomId };
      break;
    }
    case 'chat': {
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      if (typeof body.message !== 'string') {
        return json({ error: 'message requerido', code: 'EMPTY_MESSAGE' }, 400);
      }
      const trimmed = body.message.trim();
      if (!trimmed) return json({ error: 'El mensaje está vacío', code: 'EMPTY_MESSAGE' }, 400);
      if (trimmed.length > 200) {
        return json({ error: 'El mensaje es demasiado largo', code: 'MESSAGE_TOO_LONG' }, 400);
      }
      const sanitized = trimmed.replace(/[<>]/g, '');
      rpcName = 'publish_room_chat';
      args = {
        p_user_id: userId,
        p_room_id: body.roomId,
        p_body: sanitized,
      };
      break;
    }
    case 'get': {
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      rpcName = 'get_private_room';
      args = { p_user_id: userId, p_room_id: body.roomId };
      break;
    }
    case 'touch': {
      if (!body.roomId) return json({ error: 'roomId requerido', code: 'ROOM_NOT_FOUND' }, 400);
      rpcName = 'touch_room_presence';
      args = { p_user_id: userId, p_room_id: body.roomId };
      break;
    }
    default:
      return json({ error: 'action no válida', code: 'INVALID_ACTION' }, 400);
  }

  const { data, error } = await admin.database.rpc(rpcName, args);
  if (error) {
    const mapped = mapRpcError(error);
    return json({ error: mapped.message, code: mapped.code }, mapped.status);
  }

  if (action === 'chat') {
    return json({ message: data });
  }
  if (action === 'touch') {
    return json({ ok: true });
  }

  return json({ room: data });
}

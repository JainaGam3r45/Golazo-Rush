export type PrivateRoomError = {
  code: string;
  message: string;
};

export type RoomTransport = 'rpc' | 'game-server' | 'none';

export type RoomRpcCall = {
  fn: string;
  args: Record<string, unknown>;
  shape: 'room' | 'message' | 'ok';
};

const ROOM_RPC_CODES =
  /\b(UNAUTHORIZED|ALREADY_IN_ROOM|ACTIVE_ROOM|INVALID_DURATION|INVALID_FORMATION|INVALID_TEAM|INVALID_CODE|ROOM_NOT_FOUND|ROOM_CLOSED|ROOM_EXPIRED|ROOM_FULL|TEAM_TAKEN|ROOM_LOCKED|NOT_A_MEMBER|NEED_OPPONENT|LOADOUT_INCOMPLETE|NOT_READY|NOT_HOST|START_CONFLICT|EMPTY_MESSAGE|MESSAGE_TOO_LONG|RATE_LIMITED|ROOM_CODE_COLLISION|ROOM_CREATE_FAILED|SESSION_EXPIRED|SPECTATOR_READONLY|INVALID_LINEUP|SEAT_TAKEN|SIDE_FULL|INVALID_SEAT)\b/;

export const ROOM_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Debes iniciar sesión',
  ALREADY_IN_ROOM: 'Tienes una sala activa. Reanúdala o abandónala.',
  ACTIVE_ROOM: 'Tienes una sala activa. Reanúdala o abandónala.',
  INVALID_DURATION: 'Duración no válida',
  INVALID_FORMATION: 'Formación no válida',
  INVALID_TEAM: 'Selección no válida',
  INVALID_CODE: 'El código no existe o expiró.',
  ROOM_NOT_FOUND: 'El código no existe o expiró.',
  ROOM_CLOSED: 'La sala ya no está disponible',
  ROOM_EXPIRED: 'El código no existe o expiró.',
  ROOM_FULL: 'La sala ya está llena.',
  TEAM_TAKEN: 'Esa selección ya está ocupada',
  ROOM_LOCKED: 'La sala no admite cambios ahora',
  NOT_A_MEMBER: 'No eres miembro de esta sala',
  NEED_OPPONENT: 'Espera a que se una un rival',
  LOADOUT_INCOMPLETE: 'Elige selección y formación antes de listo',
  NOT_READY: 'Los jugadores deben estar listos',
  NOT_HOST: 'Solo el anfitrión puede iniciar',
  START_CONFLICT: 'No se pudo iniciar el partido',
  EMPTY_MESSAGE: 'El mensaje está vacío',
  MESSAGE_TOO_LONG: 'El mensaje es demasiado largo',
  RATE_LIMITED: 'Espera un momento antes de enviar otro mensaje',
  ROOM_CODE_COLLISION: 'No se pudo generar un código de sala',
  ROOM_CREATE_FAILED: 'No se pudo crear la sala',
  SPECTATOR_READONLY: 'Los espectadores solo pueden ver la sala',
  INVALID_LINEUP: 'Alineación no válida',
  SEAT_TAKEN: 'Ese puesto ya está ocupado',
  SIDE_FULL: 'Ese equipo ya tiene 2 jugadores',
  INVALID_SEAT: 'Puesto no válido',
  INTERNAL_ERROR: 'Error interno del servidor',
  NOT_CONFIGURED: 'InsForge no está configurado',
  NETWORK_ERROR: 'No se pudo conectar al servidor del partido.',
  SERVER_UNAVAILABLE: 'No se pudo conectar al servidor del partido.',
  INVOKE_ERROR: 'No se pudo completar la acción',
  ROOM_ERROR: 'Error de sala',
  SESSION_EXPIRED: 'La sesión expiró. Vuelve a iniciar sesión.',
};

/**
 * Primary path is authenticated DB RPC via SDK.
 * Optional Compute game-server only when PUBLIC_GAME_SERVER_URL is set and InsForge is not.
 */
export function selectRoomTransport(options: {
  insforgeConfigured: boolean;
  gameServerUrl: string | null;
}): RoomTransport {
  if (options.insforgeConfigured) return 'rpc';
  if (options.gameServerUrl) return 'game-server';
  return 'none';
}

export function mapRoomRpcErrorMessage(raw: string | null | undefined): PrivateRoomError {
  const text = raw ?? '';
  const codeMatch = text.match(ROOM_RPC_CODES);
  const code = codeMatch?.[1] ?? 'INTERNAL_ERROR';
  return {
    code,
    message: ROOM_ERROR_MESSAGES[code] ?? ROOM_ERROR_MESSAGES.INTERNAL_ERROR,
  };
}

export function buildRoomRpcCall(
  action: string,
  body: Record<string, unknown>,
): RoomRpcCall | { error: PrivateRoomError } {
  switch (action) {
    case 'create': {
      if (typeof body.teamId !== 'string' || !body.teamId) {
        return { error: { code: 'INVALID_TEAM', message: ROOM_ERROR_MESSAGES.INVALID_TEAM } };
      }
      return {
        fn: 'create_private_room_auth',
        args: {
          p_team_id: body.teamId,
          p_formation_id: (body.formationId as string | undefined) ?? '4-4-2',
          p_duration_seconds: (body.durationSeconds as number | undefined) ?? 900,
        },
        shape: 'room',
      };
    }
    case 'join': {
      if (typeof body.code !== 'string' || !body.code) {
        return { error: { code: 'INVALID_CODE', message: ROOM_ERROR_MESSAGES.INVALID_CODE } };
      }
      if (typeof body.teamId !== 'string' || !body.teamId) {
        return { error: { code: 'INVALID_TEAM', message: ROOM_ERROR_MESSAGES.INVALID_TEAM } };
      }
      return {
        fn: 'join_private_room_auth',
        args: {
          p_code: body.code,
          p_team_id: body.teamId,
          p_formation_id: (body.formationId as string | undefined) ?? '4-4-2',
        },
        shape: 'room',
      };
    }
    case 'joinSpectator': {
      if (typeof body.code !== 'string' || !body.code) {
        return { error: { code: 'INVALID_CODE', message: ROOM_ERROR_MESSAGES.INVALID_CODE } };
      }
      return {
        fn: 'join_room_as_spectator_auth',
        args: { p_code: body.code },
        shape: 'room',
      };
    }
    case 'leave': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      return {
        fn: 'leave_private_room_auth',
        args: { p_room_id: body.roomId },
        shape: 'room',
      };
    }
    case 'loadout': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      if (!body.teamId && !body.formationId && body.lineup == null) {
        return { error: { code: 'INVALID_TEAM', message: ROOM_ERROR_MESSAGES.INVALID_TEAM } };
      }
      return {
        fn: 'update_room_loadout_auth',
        args: {
          p_room_id: body.roomId,
          p_team_id: (body.teamId as string | undefined) ?? null,
          p_formation_id: (body.formationId as string | undefined) ?? null,
          p_lineup: body.lineup ?? null,
        },
        shape: 'room',
      };
    }
    case 'claimSeat': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      if (body.side !== 'home' && body.side !== 'away') {
        return { error: { code: 'INVALID_SEAT', message: ROOM_ERROR_MESSAGES.INVALID_SEAT } };
      }
      const fieldSlot = typeof body.fieldSlot === 'number' ? body.fieldSlot : Number(body.fieldSlot);
      if (!Number.isInteger(fieldSlot) || fieldSlot < 0 || fieldSlot > 3) {
        return { error: { code: 'INVALID_SEAT', message: ROOM_ERROR_MESSAGES.INVALID_SEAT } };
      }
      return {
        fn: 'claim_room_seat_auth',
        args: {
          p_room_id: body.roomId,
          p_side: body.side,
          p_field_slot: fieldSlot,
        },
        shape: 'room',
      };
    }
    case 'ready': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      if (typeof body.ready !== 'boolean') {
        return { error: { code: 'INVALID_ACTION', message: 'ready requerido' } };
      }
      return {
        fn: 'set_room_ready_auth',
        args: { p_room_id: body.roomId, p_ready: body.ready },
        shape: 'room',
      };
    }
    case 'start': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      return {
        fn: 'start_private_room_auth',
        args: { p_room_id: body.roomId },
        shape: 'room',
      };
    }
    case 'chat': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      if (typeof body.message !== 'string') {
        return { error: { code: 'EMPTY_MESSAGE', message: ROOM_ERROR_MESSAGES.EMPTY_MESSAGE } };
      }
      const trimmed = body.message.trim();
      if (!trimmed) {
        return { error: { code: 'EMPTY_MESSAGE', message: ROOM_ERROR_MESSAGES.EMPTY_MESSAGE } };
      }
      if (trimmed.length > 200) {
        return { error: { code: 'MESSAGE_TOO_LONG', message: ROOM_ERROR_MESSAGES.MESSAGE_TOO_LONG } };
      }
      return {
        fn: 'publish_room_chat_auth',
        args: {
          p_room_id: body.roomId,
          p_body: trimmed.replace(/[<>]/g, ''),
        },
        shape: 'message',
      };
    }
    case 'get': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      return {
        fn: 'get_private_room_auth',
        args: { p_room_id: body.roomId },
        shape: 'room',
      };
    }
    case 'touch': {
      if (typeof body.roomId !== 'string' || !body.roomId) {
        return { error: { code: 'ROOM_NOT_FOUND', message: ROOM_ERROR_MESSAGES.ROOM_NOT_FOUND } };
      }
      return {
        fn: 'touch_room_presence_auth',
        args: { p_room_id: body.roomId },
        shape: 'ok',
      };
    }
    case 'getActive': {
      return {
        fn: 'get_active_room_auth',
        args: {},
        shape: 'room',
      };
    }
    case 'recoverActive': {
      return {
        fn: 'recover_active_room_auth',
        args: {},
        shape: 'room',
      };
    }
    case 'leaveActive': {
      return {
        fn: 'leave_active_room_auth',
        args: {},
        shape: 'room',
      };
    }
    default:
      return { error: { code: 'INVALID_ACTION', message: 'action no válida' } };
  }
}

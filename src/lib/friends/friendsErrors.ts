const FRIEND_RPC_CODES =
  /\b(UNAUTHORIZED|INVALID_TARGET|USER_NOT_FOUND|CANNOT_FRIEND_SELF|BLOCKED|ALREADY_FRIENDS|REQUEST_NOT_FOUND|NOT_ADDRESSEE|REQUEST_NOT_PENDING|NOT_A_PARTY|NOT_FRIENDS|EMPTY_MESSAGE|MESSAGE_TOO_LONG)\b/;

export type FriendsError = {
  code: string;
  message: string;
};

export const FRIEND_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Debes iniciar sesión',
  INVALID_TARGET: 'Indica un usuario válido',
  USER_NOT_FOUND: 'No encontramos ese jugador',
  CANNOT_FRIEND_SELF: 'No puedes agregarte a ti mismo',
  BLOCKED: 'No se puede enviar la solicitud',
  ALREADY_FRIENDS: 'Ya son amigos o hay una solicitud pendiente',
  REQUEST_NOT_FOUND: 'La solicitud no existe',
  NOT_ADDRESSEE: 'Solo el destinatario puede responder',
  REQUEST_NOT_PENDING: 'La solicitud ya fue respondida',
  NOT_A_PARTY: 'No puedes modificar esta amistad',
  NOT_FRIENDS: 'Solo puedes chatear con amigos aceptados',
  EMPTY_MESSAGE: 'El mensaje está vacío',
  MESSAGE_TOO_LONG: 'El mensaje es demasiado largo',
  NOT_CONFIGURED: 'InsForge no está configurado',
  INTERNAL_ERROR: 'Error interno del servidor',
};

export function mapFriendRpcError(raw: string | null | undefined): FriendsError {
  const text = raw ?? '';
  const codeMatch = text.match(FRIEND_RPC_CODES);
  const code = codeMatch?.[1] ?? 'INTERNAL_ERROR';
  return {
    code,
    message: FRIEND_ERROR_MESSAGES[code] ?? FRIEND_ERROR_MESSAGES.INTERNAL_ERROR,
  };
}

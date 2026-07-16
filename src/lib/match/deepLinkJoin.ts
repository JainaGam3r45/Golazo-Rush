/**
 * Pure decision helper for /play?room= / ?code= auto-join.
 */

export type DeepLinkJoinAction =
  | { action: 'wait' }
  | { action: 'guest' }
  | { action: 'resume' }
  | { action: 'join' }
  | { action: 'blocked'; reason: 'other_room' | 'busy' | 'already_tried' | 'in_lobby' | 'invalid_code' };

export function decideDeepLinkJoin(input: {
  code: string | null;
  codeValid: boolean;
  sessionReady: boolean;
  hasUser: boolean;
  hasToken: boolean;
  alreadyTried: boolean;
  busy: boolean;
  inLobby: boolean;
  pendingRoomCode: string | null;
}): DeepLinkJoinAction {
  if (!input.code) return { action: 'wait' };
  if (!input.codeValid) return { action: 'blocked', reason: 'invalid_code' };
  if (!input.sessionReady) return { action: 'wait' };
  if (input.alreadyTried) return { action: 'blocked', reason: 'already_tried' };
  if (input.busy) return { action: 'blocked', reason: 'busy' };
  if (input.inLobby) return { action: 'blocked', reason: 'in_lobby' };
  if (!input.hasUser || !input.hasToken) return { action: 'guest' };
  if (input.pendingRoomCode) {
    if (input.pendingRoomCode === input.code) return { action: 'resume' };
    return { action: 'blocked', reason: 'other_room' };
  }
  return { action: 'join' };
}

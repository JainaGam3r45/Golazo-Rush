import { ensureAccessToken, hydrateSession } from '../auth/session';
import { insforge, isInsForgeConfigured } from '../insforge';
import type { DirectMessage, FriendsListPayload } from './types';
import {
  FRIEND_ERROR_MESSAGES,
  mapFriendRpcError,
  type FriendsError,
} from './friendsErrors';

export type { FriendsError } from './friendsErrors';
export { FRIEND_ERROR_MESSAGES, mapFriendRpcError } from './friendsErrors';

type InvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FriendsError };

async function ensureSession(): Promise<FriendsError | null> {
  await hydrateSession();
  const token = await ensureAccessToken();
  if (!token) {
    return { code: 'UNAUTHORIZED', message: FRIEND_ERROR_MESSAGES.UNAUTHORIZED };
  }
  return null;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<InvokeResult<T>> {
  if (!isInsForgeConfigured || !insforge) {
    return { ok: false, error: { code: 'NOT_CONFIGURED', message: FRIEND_ERROR_MESSAGES.NOT_CONFIGURED } };
  }
  const sessionError = await ensureSession();
  if (sessionError) return { ok: false, error: sessionError };

  const { data, error } = await insforge.database.rpc(fn, args);
  if (error) {
    const anyErr = error as { message?: string; code?: string };
    return { ok: false, error: mapFriendRpcError(anyErr.message ?? anyErr.code) };
  }
  return { ok: true, data: data as T };
}

export async function listFriends(): Promise<InvokeResult<FriendsListPayload>> {
  const result = await rpc<FriendsListPayload>('list_friends_auth', {});
  if (!result.ok) return result;
  const payload = result.data ?? { friends: [], incoming: [], outgoing: [] };
  return {
    ok: true,
    data: {
      friends: Array.isArray(payload.friends) ? payload.friends : [],
      incoming: Array.isArray(payload.incoming) ? payload.incoming : [],
      outgoing: Array.isArray(payload.outgoing) ? payload.outgoing : [],
    },
  };
}

export async function sendFriendRequest(target: string): Promise<InvokeResult<unknown>> {
  const trimmed = target.trim();
  if (!trimmed) {
    return { ok: false, error: { code: 'INVALID_TARGET', message: FRIEND_ERROR_MESSAGES.INVALID_TARGET } };
  }
  return rpc('send_friend_request_auth', { p_target: trimmed });
}

export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean,
): Promise<InvokeResult<unknown>> {
  return rpc('respond_friend_request_auth', {
    p_friendship_id: friendshipId,
    p_accept: accept,
  });
}

export async function removeFriendship(friendshipId: string): Promise<InvokeResult<unknown>> {
  return rpc('remove_friendship_auth', { p_friendship_id: friendshipId });
}

export async function blockUser(targetId: string): Promise<InvokeResult<unknown>> {
  return rpc('block_user_auth', { p_target_id: targetId });
}

export async function listDirectMessages(
  peerId: string,
  limit = 50,
): Promise<InvokeResult<DirectMessage[]>> {
  const result = await rpc<DirectMessage[]>('list_direct_messages_auth', {
    p_peer_id: peerId,
    p_limit: limit,
  });
  if (!result.ok) return result;
  return { ok: true, data: Array.isArray(result.data) ? result.data : [] };
}

export async function sendDirectMessage(
  recipientId: string,
  body: string,
): Promise<InvokeResult<DirectMessage>> {
  const trimmed = body.trim().replace(/[<>]/g, '');
  if (!trimmed) {
    return { ok: false, error: { code: 'EMPTY_MESSAGE', message: FRIEND_ERROR_MESSAGES.EMPTY_MESSAGE } };
  }
  if (trimmed.length > 500) {
    return { ok: false, error: { code: 'MESSAGE_TOO_LONG', message: FRIEND_ERROR_MESSAGES.MESSAGE_TOO_LONG } };
  }
  return rpc<DirectMessage>('send_direct_message_auth', {
    p_recipient_id: recipientId,
    p_body: trimmed,
  });
}

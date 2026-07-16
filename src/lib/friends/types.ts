export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';

export type FriendPeer = {
  friendshipId: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  since?: string;
  createdAt?: string;
};

export type FriendsListPayload = {
  friends: FriendPeer[];
  incoming: FriendPeer[];
  outgoing: FriendPeer[];
};

export type DirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  displayName?: string | null;
  username?: string | null;
};

export function friendDisplayLabel(peer: {
  displayName?: string | null;
  username?: string | null;
  userId: string;
}): string {
  return peer.displayName || peer.username || peer.userId.slice(0, 8);
}

export function roomInviteText(code: string, origin = ''): string {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  const link = `${base}/play?room=${encodeURIComponent(code)}`;
  return `¡Únete a mi sala en Golazo Rush! Código ${code}: ${link}`;
}

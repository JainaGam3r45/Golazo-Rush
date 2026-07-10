export const CHANNELS = {
  PRESENCE: 'global:presence',
  RANKING: 'global:ranking',
  ACTIVITY: 'global:activity',
  LOBBY: 'lobby:main',
  match: (matchId: string) => `match:${matchId}`,
  room: (roomId: string) => `room:${roomId}`,
} as const;

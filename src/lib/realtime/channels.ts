export function dmChannelForPair(userA: string, userB: string): string {
  const [left, right] = userA < userB ? [userA, userB] : [userB, userA];
  return `dm:${left}:${right}`;
}

export const CHANNELS = {
  PRESENCE: 'global:presence',
  RANKING: 'global:ranking',
  ACTIVITY: 'global:activity',
  LOBBY: 'lobby:main',
  match: (matchId: string) => `match:${matchId}`,
  room: (roomId: string) => `room:${roomId}`,
  dm: dmChannelForPair,
} as const;

export type LiveEvent = {
  id: string;
  teamId: string;
  opponentId: string;
  type: 'goal' | 'win' | 'draw';
  minute: number;
  timestamp: string;
};

export const recentActivity: LiveEvent[] = [
  { id: '1', teamId: 'brasil', opponentId: 'alemania', type: 'goal', minute: 78, timestamp: 'hace 2 min' },
  { id: '2', teamId: 'japon', opponentId: 'uruguay', type: 'win', minute: 90, timestamp: 'hace 5 min' },
  { id: '3', teamId: 'argentina', opponentId: 'mexico', type: 'goal', minute: 34, timestamp: 'hace 8 min' },
  { id: '4', teamId: 'francia', opponentId: 'espana', type: 'draw', minute: 90, timestamp: 'hace 12 min' },
  { id: '5', teamId: 'inglaterra', opponentId: 'portugal', type: 'goal', minute: 62, timestamp: 'hace 15 min' },
  { id: '6', teamId: 'alemania', opponentId: 'brasil', type: 'goal', minute: 41, timestamp: 'hace 18 min' },
];

export type RealtimeEventName =
  | 'ranking_updated'
  | 'live_event_created'
  | 'match_created'
  | 'match_joined'
  | 'match_finished'
  | 'room_updated'
  | 'room_starting'
  | 'room_chat_message';

export type RankingUpdatedPayload = {
  teamId: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  rank: number;
};

export type LiveEventCreatedPayload = {
  id: string;
  type: string;
  teamId: string | null;
  opponentId: string;
  minute: number;
  message: string;
  createdAt: string;
};

export type MatchCreatedPayload = {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  status: string;
};

export type MatchJoinedPayload = {
  matchId: string;
  userId: string | null;
  teamId: string;
};

export type MatchFinishedPayload = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
};

export type PresenceMember = {
  type: 'user' | 'anonymous';
  presenceId: string;
  joinedAt: string;
};

export type MatchResultRequest = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  durationSeconds?: number;
};

export type MatchDecidedBy = 'regulation' | 'penalties';

export type MatchEndedDetail = {
  localMatchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  durationSeconds: number;
  decidedBy?: MatchDecidedBy;
  penaltyHomeScore?: number;
  penaltyAwayScore?: number;
};

export type MatchNeedsPenaltiesDetail = {
  localMatchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  durationSeconds: number;
};
